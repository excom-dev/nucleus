import type {
  LayersConfig,
  MapInstance,
  TAnimationOptions,
  TCameraOptions,
  TMapboxgl,
  TMapTouchEvent,
} from "./src/types";
import { EASINGS, parseCoordsFromTokens, queueTask } from "./src/utils";
import { createElement, deleteUndefined, isPojo } from "@excom/kit-utils";
import { loadDependency } from "@excom/kit-utils/load-dependency";
import { ConstructorType, Neutron, TokenList } from "@excom/neutron";

const centerCameraOpts = (el: any): TCameraOptions => {
  const coords = parseCoordsFromTokens(el.centerCoords, el.camOffset) || [0, 0];
  // `maxBounds` must be a TokenList / array of 4 finite numbers
  let maxBounds: [[number, number], [number, number]] | undefined = undefined;
  if (el.maxBounds?.length === 4) {
    const nums = Array.from(el.maxBounds, (v) => Number(v));
    if (nums.every((v) => typeof v === "number" && isFinite(v))) {
      maxBounds = [
        [nums[0], nums[1]], // SW [lng, lat]
        [nums[2], nums[3]], // NE [lng, lat]
      ];
    }
  }
  return deleteUndefined({
    center: coords, // [lng, lat]; lat must be -90..90
    zoom: el.centerZoom || 1, // starting zoom
    pitch: el.centerPitch || 0, // degrees
    bearing: el.centerBearing || 0, // degrees
    minZoom: el.minZoom ?? 10,
    maxZoom: el.maxZoom ?? 20,
    maxBounds,
  });
};
const activeCameraOpts = (el: any): TCameraOptions => {
  const coords = parseCoordsFromTokens(el.activeCoords, el.camOffset) ||
    parseCoordsFromTokens(el.centerCoords, el.camOffset) || [0, 0];
  return deleteUndefined({
    center: coords,
    zoom: el.activeZoom ?? undefined,
    pitch: el.activePitch ?? undefined,
    bearing: el.activeBearing ?? undefined,
  });
};
const shouldAnimate = (el: any): boolean => {
  return !!(
    typeof el.camAnimation === "string" ||
    el.camAnimationDuration ||
    el.camAnimationOffset?.length ||
    el.camAnimationEssential
  );
};
const animateCameraOpts = (el: any): TAnimationOptions => {
  return deleteUndefined({
    // Even `cam-animate=""` still animates with the default easing
    animate: shouldAnimate(el),
    easing:
      (el.camAnimation && EASINGS[el.camAnimation]) ||
      EASINGS["ease-out-quint"],
    duration: el.camAnimationDuration || undefined,
    offset: (el.camAnimationOffset?.length === 2
      ? el.camAnimationOffset.map((n) => Number(n))
      : undefined) as [number, number],
    essential: el.camAnimationEssential || undefined,
  });
};
const checkMapMoved = (el: any): boolean => {
  if (!el.mapInstance) return false;
  const opts = centerCameraOpts(el);
  const camCoords = el.mapInstance?.getCenter();
  const coordsTolerance = el.centerCoordsTolerance || 0.0005;
  const zoomTolerance = el.centerZoomTolerance || 0.5;
  const pitchTolerance = el.centerPitchTolerance || 0;
  const bearingTolerance = el.centerBearingTolerance || 0;

  if (
    !opts.center ||
    opts.zoom === undefined ||
    opts.pitch === undefined ||
    opts.bearing === undefined
  ) {
    return false;
  }

  const r = el.preserveCamera || [];

  return !(
    (r.includes("coords") ||
      Math.abs(camCoords.lng - opts.center[0]) <= coordsTolerance) &&
    (r.includes("coords") ||
      Math.abs(camCoords.lat - opts.center[1]) <= coordsTolerance) &&
    (r.includes("zoom") ||
      Math.abs(el.mapInstance.getZoom() - opts.zoom) <= zoomTolerance) &&
    (r.includes("pitch") ||
      Math.abs(el.mapInstance.getPitch() - opts.pitch) <= pitchTolerance) &&
    (r.includes("bearing") ||
      Math.abs(el.mapInstance.getBearing() - opts.bearing) <= bearingTolerance)
  );
};

export const MapboxView = Neutron({
  tag: "mapbox-view",
  renderRoot: {
    tag: "div",
    shadow: "open",
  },
  props: {
    mapboxPromise: Promise as ConstructorType<Promise<TMapboxgl>>,
    containerElement: HTMLElement,
    mapInstance: Object as unknown as ConstructorType<MapInstance>,
    accessToken: String,
    mapStyle: String,
    isLoaded: Boolean,
    isAnimated: Boolean,
    isMoved: Boolean,
    centerCoords: TokenList,
    centerCoordsTolerance: Number,
    centerZoom: Number,
    centerZoomTolerance: Number,
    centerPitch: Number,
    centerPitchTolerance: Number,
    centerBearing: Number,
    centerBearingTolerance: Number,
    activeCoords: TokenList,
    activeZoom: Number,
    activePitch: Number,
    activeBearing: Number,
    preserveCamera: TokenList,
    minZoom: Number,
    maxZoom: Number,
    maxBounds: TokenList,
    camOffset: TokenList,
    camAnimation: String,
    camAnimationDuration: Number,
    camAnimationOffset: TokenList,
    camAnimationEssential: Boolean,
    timerId: Number,
    isDragging: Boolean,
    clickholdMs: Number,
    droppedPin: Object,
    layers: Object as unknown as ConstructorType<LayersConfig>,
    activeLayer: String,
    visibleLayers: TokenList,
    camPadding: TokenList,
  },
})
  .defineMethods({
    holdStartCb: (
      // @ts-ignore TODO defineMethods
      { isDragging, clickholdMs, emitClickhold },
      e: TMapTouchEvent
    ) => {
      // Ignore multi-touch
      if (e.originalEvent?.touches && e.originalEvent.touches.length !== 1)
        return;
      return (
        !isDragging &&
        clickholdMs && {
          timerId: setTimeout(
            () => emitClickhold(e.lngLat),
            clickholdMs
          ) as unknown as number,
        }
      );
    },
    holdEndCb: ({ timerId }) => {
      if (timerId) clearTimeout(timerId);
    },
    holdDragstartCb: ({ timerId }) => {
      if (timerId) clearTimeout(timerId);
      return {
        isDragging: true,
      };
    },
    holdDragendCb: () => {
      return {
        isDragging: false,
      };
    },
    mapClickedCb: (_, e: TMapTouchEvent) => ({
      broadcast: ["mapbox-view-clicked", { detail: e }],
    }),
    emitClickhold: (_, lngLat) => {
      return {
        emit: [
          "mapbox-view-clickhold",
          {
            detail: lngLat,
          },
        ],
      };
    },
    loadedCallback: () => ({
      isLoaded: true,
      emit: ["mapbox-view-loaded"],
    }),
    calcIsMoved: (element, override: boolean) => ({
      isMoved: override ?? checkMapMoved(element),
    }),
    updateCamera: (
      element,
      destination: "center" | "active",
      cb?: () => Record<string, any> | any
    ) => {
      if (element.mapInstance) {
        // Already at the destination (within tolerance): skip animation,
        // but still update `isMoved` to match.
        if (destination === "center" && !checkMapMoved(element)) {
          return { calcIsMoved: [false] };
        }
        queueTask(element.mapInstance, (m) => {
          const cbResult = cb?.();
          if (!cb || cbResult) {
            const updateObject = isPojo(cbResult) ? cbResult : {};
            const cameraOpts = deleteUndefined({
              ...(destination === "center"
                ? centerCameraOpts(element)
                : activeCameraOpts(element)),
              // Drop any properties in the `preserveCamera` list
              ...Object.fromEntries(
                (element.preserveCamera || []).map((key: string) => [
                  key === "coords" ? "center" : key,
                  undefined,
                ])
              ),
              ...deleteUndefined(updateObject),
            });
            if (destination === "center" && element.isAnimated) {
              // Continuous tracking: `easeTo` for short incremental updates
              m.easeTo({ ...cameraOpts, duration: 250 });
            } else {
              m[element.isAnimated ? "flyTo" : "jumpTo"]({
                ...cameraOpts,
                ...(element.isAnimated ? animateCameraOpts(element) : {}),
              });
            }
          }
        });
        /* Return outside `queueTask` so Neutron sees the state update.
           A return inside the callback was discarded, leaving `isMoved`
           stuck after programmatic camera moves (recenter, bearing). */
        return {
          calcIsMoved: [destination === "active"],
        };
      }
    },
    zoomToOverview: (element) => {
      if (element.mapInstance) {
        queueTask(element.mapInstance, (m) => {
          m[element.isAnimated ? "easeTo" : "jumpTo"]({
            zoom: element.centerZoom ?? undefined,
          });
        });
      }
    },
  })
  .onConnected((el) => {
    if (el.isMoving) return;
    const cssLink = createElement("link", {
      rel: "stylesheet",
      href: "https://api.mapbox.com/mapbox-gl-js/v3.9.2/mapbox-gl.css",
    });
    const div = createElement("div", {
      style: "height: 100%; width: 100%;",
      id: `mapbox-container-${Math.random().toString(36).substr(2, 9)}`,
    });

    // Layers from a script slot
    const layersScript = el.querySelector('script[slot="layers"]');
    if (layersScript && layersScript.textContent) {
      try {
        const layersData = JSON.parse(layersScript.textContent);
        el.layers = layersData;
      } catch (error) {
        console.error("Failed to parse layers JSON:", error);
      }
    }

    return {
      renderRoot: {
        append: [cssLink, div],
      },
      containerElement: div,
    };
  })
  .onPropChanged(["accessToken", "containerElement"], (el, previous) => {
    if (el.accessToken && el.containerElement) {
      // `accessToken` changed: recreate the map
      const accessTokenChanged =
        previous?.accessToken && previous.accessToken !== el.accessToken;

      if (!el.mapInstance || accessTokenChanged) {
        // Tear down the existing map after an access-token change
        if (accessTokenChanged && el.mapInstance) {
          el.mapInstance.remove();
        }

        // Empty the container before creating a new map
        el.containerElement.innerHTML = "";

        return {
          mapboxPromise: loadDependency<TMapboxgl>(
            "umd",
            "https://api.mapbox.com/mapbox-gl-js/v3.9.2/mapbox-gl.js",
            "mapboxgl"
          ),
        };
      }
    }
  })
  .onPromiseResolved("mapboxPromise", (el, result) => {
    const mapbox = result.mapboxPromise as unknown as TMapboxgl;
    if (mapbox) {
      mapbox.accessToken = el.accessToken;
      return {
        mapboxPromise: null,
        // TODO support dark mode
        mapInstance: new mapbox.Map({
          container: el.containerElement!,
          style: el.mapStyle || undefined,
          ...centerCameraOpts(el),
        }),
      };
    }
  })
  .onPropSet(
    "mapInstance",
    ({ mapInstance, loadedCallback, mapClickedCb, calcIsMoved }) => {
      // Recalc `isMoved` for user gestures only, not programmatic `flyTo` / `easeTo`
      mapInstance.on("movestart", (e) => e.originalEvent && calcIsMoved(true));
      mapInstance.on("moveend", (e) => e.originalEvent && calcIsMoved());
      mapInstance.on("load", () => loadedCallback());
      queueTask(mapInstance, (m) => m.on("click", mapClickedCb));
    }
  )
  .onPropChanged("mapStyle", ({ mapInstance, mapStyle }) => {
    if (mapInstance && mapStyle) {
      queueTask(mapInstance, (m) => {
        try {
          m.setStyle(mapStyle);
        } catch (error) {
          console.warn("Failed to set map style:", error);
        }
      });
    }
  })
  .onPropChanged("camPadding", ({ mapInstance, camPadding }) => {
    if (mapInstance) {
      if (Array.isArray(camPadding) && camPadding.length >= 1) {
        const nums = camPadding.map((v: any) => Number(v) || 0);
        // 1-4 values like CSS: [all], [vertical horizontal], [top right bottom left]
        const top = nums[0];
        const right = nums.length > 1 ? nums[1] : top;
        const bottom = nums.length > 2 ? nums[2] : top;
        const left = nums.length > 3 ? nums[3] : right;
        queueTask(mapInstance, (m) =>
          m.setPadding({ top, right, bottom, left })
        );
      } else {
        queueTask(mapInstance, (m) =>
          m.setPadding({ top: 0, right: 0, bottom: 0, left: 0 })
        );
      }
    }
  })
  .onPropChanged("maxBounds", (el) => {
    if (el.mapInstance && el.maxBounds?.length === 4) {
      const nums = Array.from(el.maxBounds, (v) => Number(v));
      if (nums.every((v) => isFinite(v))) {
        queueTask(el.mapInstance, (m) =>
          m.setMaxBounds([
            [nums[0], nums[1]],
            [nums[2], nums[3]],
          ])
        );
      }
    }
  })
  .onPropChanged(
    ["centerCoords", "centerZoom", "centerPitch", "centerBearing"],
    ({ isMoved }) => !isMoved && { updateCamera: ["center"] }
  )
  .onPropChanged(
    ["activeCoords", "activeZoom", "activePitch", "activeBearing"],
    () => ({
      updateCamera: ["active"],
    })
  )
  .onEvent(
    "mapbox-view-recenter",
    ({ isMoved }) => isMoved && { updateCamera: ["center"] }
  )
  .onEvent("mapbox-view-reactive", () => ({
    updateCamera: ["active"],
  }))
  .onEvent("mapbox-view-zoom-in", ({ activeZoom, centerZoom }) => ({
    activeZoom: (activeZoom ?? centerZoom ?? 1) + 1,
  }))
  .onEvent("mapbox-view-zoom-out", ({ activeZoom, centerZoom }) => ({
    activeZoom: (activeZoom ?? centerZoom ?? 1) - 1,
  }))
  .onEvent("mapbox-view-zoom-overview", () => ({
    zoomToOverview: [],
  }))
  .onPropChanged(
    ["clickholdMs", "mapInstance"],
    ({
      clickholdMs,
      mapInstance,
      holdStartCb,
      holdEndCb,
      holdDragstartCb,
      holdDragendCb,
    }) => {
      if (mapInstance) {
        // Drop previous mouse + touch listeners
        mapInstance.off("mousedown", holdStartCb);
        mapInstance.off("mouseup", holdEndCb);
        mapInstance.off("touchstart", holdStartCb);
        mapInstance.off("touchend", holdEndCb);
        mapInstance.off("touchmove", holdEndCb);
        mapInstance.off("touchcancel", holdEndCb);
        mapInstance.off("dragstart", holdDragstartCb);
        mapInstance.off("dragend", holdDragendCb);
        if (clickholdMs) {
          const nav = navigator as any;
          const isTouch = "ontouchstart" in window || nav.maxTouchPoints > 0;
          if (isTouch) {
            mapInstance.on("touchstart", holdStartCb);
            mapInstance.on("touchend", holdEndCb);
            mapInstance.on("touchmove", holdEndCb);
            mapInstance.on("touchcancel", holdEndCb);
          } else {
            mapInstance.on("mousedown", holdStartCb);
            mapInstance.on("mouseup", holdEndCb);
          }
          // A drag cancels the hold
          mapInstance.on("dragstart", holdDragstartCb);
          mapInstance.on("dragend", holdDragendCb);
        }
      }
    }
  )
  .onPropSet("droppedPin", (_, previous) => {
    (previous.droppedPin as any)?.remove();
  })
  .onPropChanged("activeLayer", ({ mapInstance, layers, activeLayer }) => {
    if (!mapInstance || !activeLayer) return;

    // Toggle custom layers from `layers`
    if (layers) {
      Object.keys(layers).forEach((layerId) => {
        const fullLayerId = `custom-layer-${layerId}`;
        if (mapInstance.getLayer(fullLayerId)) {
          mapInstance.setLayoutProperty(
            fullLayerId,
            "visibility",
            layerId === activeLayer ? "visible" : "none"
          );
        }
      });
    }

    // Toggle style layers: hide others of the same type, show the active one
    queueTask(mapInstance, (m) => {
      try {
        const targetLayer = m.getLayer(activeLayer);
        if (!targetLayer) return;
        const style = m.getStyle();
        style.layers.forEach((layer) => {
          if (layer.type === targetLayer.type) {
            m.setLayoutProperty(
              layer.id,
              "visibility",
              layer.id === activeLayer ? "visible" : "none"
            );
          }
        });
      } catch (error) {
        console.error(`Error setting active layer ${activeLayer}:`, error);
      }
    });
  })
  .onPropChanged("visibleLayers", ({ mapInstance, visibleLayers }) => {
    if (!mapInstance) return;
    queueTask(mapInstance, (m) => {
      const style = m.getStyle();
      if (!style?.layers) return;
      style.layers.forEach((layer) => {
        try {
          // Only layers with a layout property (skip required base layers)
          if (layer.layout !== undefined) {
            const shouldBeVisible = visibleLayers?.includes(layer.id);
            const currentVisibility = m.getLayoutProperty(
              layer.id,
              "visibility"
            );
            if (currentVisibility !== (shouldBeVisible ? "visible" : "none")) {
              m.setLayoutProperty(
                layer.id,
                "visibility",
                shouldBeVisible ? "visible" : "none"
              );
            }
          }
        } catch (error) {
          console.warn(
            `Could not set visibility for layer ${layer.id}:`,
            error
          );
        }
      });
    });
  })
  .onPropChanged(
    ["layers", "mapInstance"],
    ({ layers, mapInstance, activeLayer }) => {
      if (mapInstance && layers) {
        // Remove existing layers
        const existingLayers = mapInstance.getStyle()?.layers || [];
        existingLayers.forEach((layer) => {
          if (layer.id.startsWith("custom-layer-")) {
            mapInstance.removeLayer(layer.id);
          }
        });

        // Add the new layers
        Object.entries(layers).forEach(
          ([layerId, layerConfig]: [string, any]) => {
            const fullLayerId = `custom-layer-${layerId}`;

            // Add the source if it's missing
            if (!mapInstance.getSource(fullLayerId)) {
              mapInstance.addSource(fullLayerId, layerConfig.source);
            }

            // Add the layer
            mapInstance.addLayer({
              id: fullLayerId,
              ...layerConfig.layer,
              source: fullLayerId,
              layout: {
                ...layerConfig.layer.layout,
                visibility: layerId === activeLayer ? "visible" : "none",
              },
            });
          }
        );
      }
    }
  )
  .onDisconnected(
    ({
      mapInstance,
      shadowRoot,
      isMoving,
      holdStartCb,
      holdEndCb,
      holdDragstartCb,
      holdDragendCb,
    }) => {
      if (isMoving) return;
      if (mapInstance) {
        // Drop holdstart / holdend listeners from click-hold
        mapInstance.off("mousedown", holdStartCb);
        mapInstance.off("mouseup", holdEndCb);
        mapInstance.off("touchstart", holdStartCb);
        mapInstance.off("touchend", holdEndCb);
        mapInstance.off("touchmove", holdEndCb);
        mapInstance.off("touchcancel", holdEndCb);
        mapInstance.off("dragstart", holdDragstartCb);
        mapInstance.off("dragend", holdDragendCb);
        // `remove()` drops built-in listeners (movestart, moveend, load, click)
        mapInstance.remove();
      }
      if (shadowRoot) {
        shadowRoot.innerHTML = "";
      }
    }
  );
