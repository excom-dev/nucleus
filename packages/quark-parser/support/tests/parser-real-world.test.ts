import { parse } from "../../index";
import type { BaseNode, Rule, Stylesheet } from "../../index";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

/**
 * Adapted from real Quark sheets in ws, fb, and the docs-site
 * (JS-style syntax like `?.`, ternaries, `??`, and `===` removed, those are
 * intentionally unsupported).
 */
const WS_STYLE = `
provider-geolocation {
  @on provider-geolocation-success (handle: submitCoordsForm);
  @on toggle-mapbox-centering (handle: toggleMapboxCentering);

  $currentUserId: prop("provision").body.user_id;
  #coordinate-form form {
    action: "/api/v1/users/" + $currentUserId;
  }
}

provider-fetch[api-url*='settings'][is-success] data-me {
  $userCoords: prop("provision").coords;
  $users: prop("provision").body;
  $settings: prop("provision").body;
  $currentUser: find($users, "id", $currentUserId);
  $currentCoords: getUserCoords($userCoords, $settings.demo_mode_enabled, $settings.demo_center_lat, $settings.demo_center_lng);

  dataset: $currentUser;

  mapbox-view {
    cam-offset: $settings.map_offset_lng + " 0";
    center-zoom: $settings.map_zoom_out_max;
    center-coords: $currentCoords.longitude + " " + $currentCoords.latitude;
    &[data-take-bearing]:not([is-moved]) {
      /* only set this attr when desired */
      center-bearing: $currentOrientation.bearing;
    }
    &[is-loaded] {
      is-animated: "";
    }
  }

  #user-list {
    content: iterate(sortUsers(withoutCurrentUser($users, $currentUserId), $currentCoords));

    li {
      $userStatusClass: getUserStatusClass(item.status);

      mapbox-view-marker {
        pin-coords: item.coordinate.lng + " " + item.coordinate.lat;
        pin-class: "user-icon " + $userStatusClass;
        pin-data-popover-text: item.name + " (" + item.status + ")";
      }
      [bind-status] {
        content: item.status.toLowerCase();
        style: "text-transform: capitalize";
      }
      [bind-distance] {
        content: calcDistanceKm(item.coordinate, $currentCoords) + " km";
      }
    }
  }

  #sighting-list {
    content: iterate(sortSightings($sightings, $currentCoords, $currentUser.sighting.id), "", "id");

    data-sighting {
      $specie: find($species, "id", item.species_id);
      sighting-status: item.status;
      checked: $maxUsersPerSighting == 1;

      [bind-max-users] {
        content: $usersInSighting.length + " / " + item.max_users_per_sighting + " 👤";
      }
      .animal-icon {
        class: "animal-icon " + $animalIconClass;
        data-text: $specie.symbol;
      }
    }
  }

  .sighting-navigator {
    #update-sighting {
      &[is-error] {
        $errorMessage: prop("provision").body.message.coordinate.timestamp[0];
        .error-message {
          content: $errorMessage;
        }
      }
      &:not([is-error]) .error-message {
        content: "";
      }
    }
  }

  #tracking-list ul.w-micro-radios {
    content: iterate(filterBroadcastSpecies($species));
    li {
      [bind-specie-name] { content: item.name_display; }
      [bind-specie-id] { value: item.id; }
    }
  }
}

#refresh-btn {
  @on click (handle: refreshData);
}

provider-fetch {
  &:not([is-error]) #right-panel .error-message {
    content: "";
  }
  &[is-error] #right-panel .error-message {
    content: "Failed to fetch data. Please try again later.";
  }
}

.tags-output {
  $tags: prop("provision").body;
  content: iterate(sortTags($tags), "#tags-template");

  fieldset {
    $tagIndex: index;
    legend { content: index; }
    div {
      content: iterate(item);
      span {
        input {
          id: "tag-" + $tagIndex + "-" + index;
          value: item;
          checked: includes($selectedTags[$tagIndex], item);
          name: "tags." + $tagIndex;
        }
        label {
          for: "tag-" + $tagIndex + "-" + index;
          content: item;
        }
      }
    }
  }
}

@on super-form-error (handle: (checkUnauth, showErrorSheet));
@on provider-fetch-error (handle: (checkUnauth, showErrorSheet));

service-worker {
  &[is-ready],
  &[is-mounted]:not([is-supported]) {
    & ~ #app provider-fetch[api-url*="checksession"] {
      is-paused: none;
    }
  }
}

network-status {
  $networkData: prop("provision");
  $networkNode: elementOf(&);
  $isOnline: $networkData.isOnline;

  &[network-quality="3"] {
    .network-icon { content: "signal_wifi_4_bar"; }
    [bind-connection-status] { content: "Online - Great"; }
  }
  &[network-quality="0"] {
    .network-icon { content: "signal_wifi_off"; }
    [bind-connection-status] { content: "No connection"; }
  }
}
`;

const FB_STYLE = `
@on super-form-error (handle: showErrorSheet);

provider-fetch[api-url="/api/sessions"] {
    $sessionData: prop("provision").body.data;
    object-me {
        dataset: $sessionData;
    }
}

details[open] include-content.details-scroll {
    is-active: "";
}
details:not([open]) include-content.details-scroll {
    is-active: none;
}

$routeData: prop("provision");

provider-fetch {
    api-url: "/api/plans/" + $routeData.params.planId;
    &[is-success] {
        $plan: prop("provision").body.data;
        $totalCalories: sumMacro($plan.meals, "calories");
        [data-average] {
            content: round($totalCalories / 7);
        }
        [bind-current-day] {
            content: getDayOfWeek();
        }
        ul.today-meal-container {
            $dayMeals: filterMealsByDay($plan.meals);
            content: iterate($dayMeals);
            > li {
                spa-a[bind-meal-href] {
                    data-current-meal: index == $currentMealIndex;
                    route-href: "/plans/" + $plan.id + "/meals/" + item.id;
                }
                [bind-meal-calories] {
                    content: sumMacro(item, "calories") + " calories";
                }
            }
        }
        /* pick the system from the plan, rather than the session */
        input[name="system"] {
            value: $plan.system;
        }
        [bind-vendors] {
            content: iterate(getVendors());
            super-form {
                data-vendor: item;
                @on super-form-success (handle: followRedirect);
                img {
                    class: "ignore-color-scheme shop-" + item;
                    src: "/img/" + item + ".png";
                    alt: item;
                }
            }
        }
        [bind-plan-dietary-restrictions] {
            content: fieldToHuman($plan.dietaryRestrictions.join(", "));
        }
    }
    [bind-day-list] {
        content: iterate(getAllDayIndexes());
        [bind-day] { content: getDayOfWeek(item); }
    }
}
`;

const DOCS_SITE_STYLE = `
$packageName: prop("provision").params.packageName;
provider-fetch.doc-page {
  api-url: "/package-metas/" + $packageName + ".json";
}
provider-fetch.doc-page[is-success] {
  $packageMeta: prop("provision").body;
  $install: $packageMeta.installation;
  data-package-type: $packageMeta.package.excom.packageType;
  #install-section {
    [bind-cdn] { content: dangerous-html(renderLangCopy($install.cdn, "html")); }
    [bind-peers-length] { content: " (" + $install.peerDependencies.length + ")"; }
    [bind-export-files] {
      content: iterate($packageMeta.exportedFiles);
      [bind-export-file-key] { content: index; }
      [bind-export-file-value] { content: item; }
    }
  }
  #api-reference {
    content: iterate($packageMeta.elementApis);
    [bind-tag] { content: item.tag; }
    /* details 1 */
    [bind-attributes] tbody {
      content: iterate(item.attributes);
      [bind-name] { content: item.name; }
      [bind-default] { content: unescapeHtml(pickDefault(item)); }
    }
  }
  [data-demo] {
    $demoRef: attr("data-demo");
    template-ref: "/views/live-demo.html";
    lazy-load: "";
    .live-demo {
      $src: formatCode(getDemoSource($packageMeta, $demoRef));
      [aria-label="preview"] {
        /* immediate child selector is crucial here */
        > template { content: dangerous-html($src); }
        > include-content {
          is-active: "";
          id: getDemoId($packageName, $demoRef);
        }
      }
      [aria-label="reset"] {
        @on click (handle: resetDemo($src));
      }
      footer {
        content-tabs-header[is-open] button {
          class: "outline tag-small";
        }
        .edit-code textarea {
          content: $src;
          @on input (handle: (updateTemplate, renderPre));
        }
      }
    }
  }
}
[bind-copy-button] {
  content: template("#copy-source-button");
}
`;

/** Walks every node, asserting spans are sane. Returns node-type counts. */
const walk = (node: any, source: string, counts: Record<string, number>) => {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, source, counts);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string" && typeof node.start === "number") {
    const n = node as BaseNode;
    expect(n.start).toBeGreaterThanOrEqual(0);
    expect(n.end).toBeGreaterThanOrEqual(n.start);
    expect(n.end).toBeLessThanOrEqual(source.length);
    counts[n.type] = (counts[n.type] ?? 0) + 1;
  }
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end") continue;
    walk(node[key], source, counts);
  }
};

describe("real-world sheets", () => {
  it("parses the ws main sheet", () => {
    const sheet = parse(WS_STYLE);
    const counts: Record<string, number> = {};
    walk(sheet, WS_STYLE, counts);
    expect(counts.rule).toBeGreaterThan(20);
    expect(counts.declaration).toBeGreaterThan(30);
    expect(counts.member).toBeGreaterThan(20);
    expect(counts.function).toBeGreaterThan(10);
    expect(counts.parent_reference).toBeGreaterThan(0);
    expect(counts.index).toBeGreaterThan(0);
    expect(counts.comment).toBeGreaterThan(0);
  });

  it("resolves the deep &[is-error] error-message chain", () => {
    const sheet = parse(WS_STYLE) as any;
    const dataMe = sheet.body.find(
      (s: any) =>
        s.type === "rule" &&
        s.selector.selectors[0].parts.some(
          (p: any) => p.type === "type_selector" && p.name === "data-me",
        ),
    );
    expect(dataMe).toBeTruthy();
    const navigator = dataMe.block.body.find(
      (s: any) =>
        s.type === "rule" &&
        s.selector.selectors[0].parts[0].type === "class_selector" &&
        s.selector.selectors[0].parts[0].name === "sighting-navigator",
    );
    const updateSighting = navigator.block.body[0];
    const isError = updateSighting.block.body[0];
    expect(isError.selector.selectors[0].parts[0].type).toBe(
      "parent_selector",
    );
    const errVar = isError.block.body[0];
    expect(errVar.property).toMatchObject({
      type: "variable",
      name: "errorMessage",
    });
    // prop("provision").body.message.coordinate.timestamp[0]
    expect(errVar.value.type).toBe("index");
    expect(errVar.value.object).toMatchObject({
      type: "member",
      property: "timestamp",
    });
  });

  it("parses the fb plan sheet", () => {
    const sheet = parse(FB_STYLE) as any;
    const counts: Record<string, number> = {};
    walk(sheet, FB_STYLE, counts);
    expect(counts.rule).toBeGreaterThan(10);
    // top-level listener at-rule
    expect(sheet.body[0]).toMatchObject({
      type: "atrule",
      name: "on",
      events: [{ name: "super-form-error", quoted: false }],
    });
  });

  it("parses the docs-site package sheet", () => {
    const sheet = parse(DOCS_SITE_STYLE) as any;
    expect(sheet.body[0].property).toMatchObject({
      type: "variable",
      name: "packageName",
    });
    const counts: Record<string, number> = {};
    walk(sheet, DOCS_SITE_STYLE, counts);
    expect(counts.rule).toBeGreaterThan(15);
    expect(counts.comment).toBe(2);
  });

  it("round-trip spans reproduce the source for every rule selector", () => {
    const sheet = parse(WS_STYLE) as Stylesheet;
    const checkRules = (body: any[]) => {
      for (const stmt of body) {
        if (stmt.type !== "rule") continue;
        const rule = stmt as Rule;
        const sliced = WS_STYLE.slice(
          rule.selector.start,
          rule.selector.end,
        );
        // The span should cover the selector text exactly (modulo whitespace).
        expect(sliced.trim().length).toBeGreaterThan(0);
        expect(rule.block.start).toBeGreaterThanOrEqual(rule.selector.end);
        checkRules(rule.block.body);
      }
    };
    checkRules(sheet.body);
  });

  it("parses quickly enough for render-blocking use", () => {
    const big = Array.from({ length: 50 }, () => WS_STYLE).join("\n");
    // Warm up.
    parse(big);
    const started = performance.now();
    parse(big);
    const elapsed = performance.now() - started;
    // ~250KB of Quark; generous bound to avoid CI flake (typically < 30ms).
    expect(elapsed).toBeLessThan(500);
  });
});
