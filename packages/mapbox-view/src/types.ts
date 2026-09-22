// Import mapbox-gl as `type` only. Never bundle it.
import type mapboxglDefault from "mapbox-gl";

export type TMapboxgl = typeof mapboxglDefault;
export type TMapboxglMarkerOptions = mapboxgl.MarkerOptions;
export type TMapTouchEvent = mapboxgl.MapTouchEvent;
export type TCameraOptions = mapboxgl.CameraOptions;
export type TAnimationOptions = mapboxgl.AnimationOptions;
export type MapInstance = InstanceType<TMapboxgl["Map"]>;

export interface LayerSource {
  type: string;
  data?: any;
  url?: string;
  tiles?: string[];
  [key: string]: any;
}

export interface LayerConfig {
  source: LayerSource;
  layer: {
    type: string;
    paint?: Record<string, any>;
    layout?: Record<string, any>;
    filter?: any[];
    [key: string]: any;
  };
}

export interface LayersConfig {
  [layerId: string]: LayerConfig;
}
