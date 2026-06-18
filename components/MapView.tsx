"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export interface MapPoint {
  id?: number;
  lat: number;
  lng: number;
  label?: string;
  href?: string;
}

// Free CARTO dark basemap (OSM data). Fine for low-volume personal use.
const DARK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

export function MapView({
  points,
  className,
  zoom = 12,
}: {
  points: MapPoint[];
  className?: string;
  zoom?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const valid = points.filter((p) => p.lat != null && p.lng != null);
    const map = new maplibregl.Map({
      container: ref.current,
      style: DARK_STYLE,
      center: valid.length ? [valid[0].lng, valid[0].lat] : [0, 20],
      zoom: valid.length ? zoom : 1,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const bounds = new maplibregl.LngLatBounds();
    for (const p of valid) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:14px;height:14px;border-radius:50%;background:#5b8cff;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4);cursor:pointer";
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([p.lng, p.lat])
        .addTo(map);
      if (p.label) {
        marker.setPopup(new maplibregl.Popup({ offset: 12 }).setText(p.label));
        el.addEventListener("mouseenter", () => marker.togglePopup());
        el.addEventListener("mouseleave", () => marker.togglePopup());
      }
      if (p.href) el.addEventListener("click", () => (window.location.href = p.href!));
      bounds.extend([p.lng, p.lat]);
    }
    if (valid.length > 1) map.fitBounds(bounds, { padding: 60, maxZoom: 14 });

    return () => map.remove();
  }, [points, zoom]);

  return <div ref={ref} className={className} />;
}
