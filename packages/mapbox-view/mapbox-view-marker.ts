import type { MapboxView as TMapboxView } from "./mapbox-view";
import type {
  MapInstance,
  TMapboxgl,
  TMapboxglMarkerOptions,
} from "./src/types";
import {
  parseCoordsFromTokens,
  parseNumsFromTokens,
  queueTask,
} from "./src/utils";
import { deleteUndefined, selectOne } from "@excom/kit-utils";
import { ConstructorType, Neutron, TokenList } from "@excom/neutron";

// Workaround until partial type inference lands: https://github.com/Microsoft/TypeScript/pull/26349

type T_HTMLMapboxViewMarkerElement = typeof TMapboxView.CustomElement;

export const MapboxViewMarker = Neutron({
  tag: "mapbox-view-marker",
  props: {
    mapRef: String,
    mapElement:
      HTMLElement as unknown as ConstructorType<T_HTMLMapboxViewMarkerElement>,
    mapInstance: Object as unknown as ConstructorType<MapInstance>,
    markerInstance: Object as unknown as TMapboxgl["Marker"],
    markerElement: HTMLElement,
    pinTag: String,
    pinDataText: String,
    pinDataPopoverText: String,
    pinClass: String,
    pinCoords: TokenList,
    pinOffset: TokenList,
    pinAnchor: String,
    pinColor: String,
    pinScale: Number,
    pinDraggable: Boolean,
    pinClickTolerance: Number,
    pinRotation: Number,
    pinRotationAlignment: String,
    pinPitchAlignment: String,
    pinOccludedOpacity: Number,
    pinStyle: String,
    focusEvents: TokenList,
    panBoundaries: TokenList,
    blurOnMapClick: Boolean,
    singletonName: String,
  },
}).defineMethods({
  panToMarker: ({ panBoundaries, markerElement, mapElement, pinCoords }) => {
    const markerRect = (markerElement as Element).getBoundingClientRect?.();
    const mapRect = (mapElement as Element).getBoundingClientRect?.();
    const _panBoundaries = parseNumsFromTokens(panBoundaries) || [
      15, 15, 15, 15,
    ];
    const isTop = markerRect.top < mapRect.height * (_panBoundaries[0] / 100);
    const isRight =
      markerRect.right > mapRect.width * (1 - _panBoundaries[1] / 100);
    const isBottom =
      markerRect.bottom > mapRect.height * (1 - _panBoundaries[2] / 100);
    const isLeft = markerRect.left < mapRect.width * (_panBoundaries[3] / 100);
    return {
      ...((isTop || isRight || isBottom || isLeft) && {
        mapElement: {
          activeCoords: pinCoords || [],
          emit: ["mapbox-view-reactive"],
        },
      }),
      emit: ["mapbox-view-marker-focus"],
    };
  },
  handleMarkerClick: ({ blurOnMapClick }, e: Event) => {
    if (blurOnMapClick) {
      e.stopPropagation();
    }
    return { panToMarker: [], emit: ["mapbox-view-marker-interacted"] };
  },
  setMapElement: (element) => {
    const existingMapElement = element.mapElement;
    const mapElement = selectOne(element.mapRef || "mapbox-view", {
      scope: element,
    }) as T_HTMLMapboxViewMarkerElement;
    if (mapElement && mapElement !== existingMapElement) {
      return {
        mapElement,
      };
    }
  },
  setMapAndMarker: (element, mapInstance: MapInstance, mb: TMapboxgl) => ({
    mapInstance,
    markerInstance: new mb.Marker(markerOpts(element)),
  }),
  blurCallback: () => ({
    emit: ["mapbox-view-marker-blur"],
  }),
  singletonCallback: (element, { detail }: CustomEvent<typeof element>) => {
    if (
      element !== detail &&
      element.singletonName &&
      detail?.singletonName &&
      element.singletonName === detail?.singletonName
    ) {
      element.markerElement?.classList.remove("is-active");
    }
  },
});

type PartialProps = Partial<(typeof MapboxViewMarker)["Props"]>;

const markerOpts = (element: PartialProps): TMapboxglMarkerOptions => {
  // @ts-ignore
  return deleteUndefined({
    element: element.pinTag
      ? document.createElement(element.pinTag)
      : undefined,
    offset: parseCoordsFromTokens(element.pinOffset),
    color: element.pinColor,
    scale: element.pinScale,
    anchor: (element.pinAnchor ||
      undefined) as TMapboxglMarkerOptions["anchor"],
    draggable: element.pinDraggable,
    rotation: element.pinRotation,
    rotationAlignment: element.pinRotationAlignment,
    pitchAlignment: element.pinPitchAlignment,
    occludedOpacity: element.pinOccludedOpacity,
    className: element.pinClass,
  });
};

MapboxViewMarker.onConnected(({ isMoving, mapRef, setMapElement }) => {
  // setTimeout to ensure map element is instantiated; the timer id must not
  // be returned
  if (!isMoving && !mapRef) setTimeout(setMapElement, 0);
})
  .onPropSet("mapRef", ({ setMapElement }) => {
    // Defer so the map element is instantiated
    setTimeout(setMapElement, 0);
  })
  .onPropSet("mapElement", ({ mapElement, setMapAndMarker }) => {
    if (mapElement.mapInstance) {
      queueTask(mapElement.mapInstance, setMapAndMarker);
    } else {
      // Map not ready yet (first load / Mapbox GL still loading).
      // Wait for load, then init the marker.
      mapElement.addEventListener(
        "mapbox-view-loaded",
        () => queueTask(mapElement.mapInstance, setMapAndMarker),
        { once: true }
      );
    }
  })
  .onDisconnected(({ markerInstance, isMoving }) => {
    if (!isMoving) {
      if (markerInstance) {
        markerInstance.remove();
      }
      return {
        mapElement: null,
        mapInstance: null,
        markerInstance: null,
        markerElement: null,
      };
    }
  })
  .onPropChanged(
    ["pinCoords", "markerInstance"],
    ({ pinCoords, markerInstance, mapInstance, markerElement }) => {
      const coords = parseCoordsFromTokens(pinCoords);
      if (markerInstance && coords && mapInstance) {
        markerInstance.setLngLat(coords);
        markerInstance.addTo(mapInstance);
        return (
          !markerElement && {
            markerElement: markerInstance.getElement(),
          }
        );
      }
    }
  )
  .onPropChanged(
    ["markerInstance", "pinClass"],
    ({ markerInstance, pinClass }, previous) => {
      if (markerInstance) {
        if (previous?.pinClass) {
          previous.pinClass
            .split(" ")
            .forEach((c) => markerInstance.removeClassName(c));
        }
        pinClass?.split(" ")?.forEach((c) => markerInstance.addClassName(c));
      }
    }
  )
  .onPropChanged(
    ["markerElement", "pinDataText"],
    ({ markerElement, pinDataText }) => {
      if (markerElement) {
        return {
          markerElement: {
            setAttribute: ["data-text", pinDataText || ""],
          },
        };
      }
    }
  )
  .onPropChanged(
    ["markerElement", "pinDataPopoverText"],
    ({ markerElement, pinDataPopoverText }) => {
      if (markerElement) {
        return {
          markerElement: {
            setAttribute: ["data-popover-text", pinDataPopoverText || ""],
          },
        };
      }
    }
  )
  .onPropChanged(
    ["pinStyle", "markerElement"],
    ({ pinStyle, markerElement }) => {
      if (markerElement) {
        markerElement.setAttribute(
          "style",
          `${markerElement.getAttribute("style") ?? ""}; ${pinStyle ?? ""}`
        );
      }
    }
  )
  .onPropChanged(
    ["markerElement", "focusEvents"],
    ({ markerElement, handleMarkerClick, focusEvents }, previous) => {
      if (markerElement) {
        return {
          markerElement: {
            toggleListeners: [
              ...(focusEvents || []).map((k) => [k, handleMarkerClick, true]),
              ...(previous?.focusEvents
                ? (previous.focusEvents || []).map((k) => [
                    k,
                    handleMarkerClick,
                    false,
                  ])
                : []),
            ],
          },
        };
      }
    }
  )
  .onEvent("mapbox-view-marker-focus-trigger", (_, e) => {
    e.stopPropagation();
    return {
      panToMarker: [],
    };
  })
  .onEventDefault("mapbox-view-marker-focus", ({ markerElement }) => {
    markerElement?.classList.add("is-active");
    return {
      broadcast: ["mapbox-view-marker-focus", { detail: markerElement }],
    };
  })
  .onEvent("mapbox-view-marker-blur-trigger", (_, e) => {
    e.stopPropagation();
    return {
      emit: ["mapbox-view-marker-blur"],
    };
  })
  .onEventDefault("mapbox-view-marker-blur", ({ markerElement }) => {
    markerElement?.classList.remove("is-active");
  })
  .onPropChanged("blurOnMapClick", ({ blurOnMapClick, blurCallback }) => ({
    toggleBroadcastListeners: [
      ["mapbox-view-clicked", blurCallback, !!blurOnMapClick],
    ],
  }))
  .onPropChanged("singletonName", ({ singletonName, singletonCallback }) => ({
    toggleBroadcastListeners: [
      ["mapbox-view-marker-focus", singletonCallback, !!singletonName],
    ],
  }));
