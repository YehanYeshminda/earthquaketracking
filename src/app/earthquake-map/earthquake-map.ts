import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  effect,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import * as L from 'leaflet';
import { EarthquakeFeature } from '../earthquake';
import { ThemeService } from '../theme.service';

const PLATES_URL =
  'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json';

@Component({
  selector: 'app-earthquake-map',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="map-container" #mapEl></div>`,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .map-container {
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class EarthquakeMap implements AfterViewInit, OnChanges, OnDestroy {
  @Input() features: EarthquakeFeature[] = [];
  @Input() selectedId: string | null = null;
  /** When set (playback active), markers fade by recency relative to this cursor. */
  @Input() playbackTime: number | null = null;
  @Input() showPlates = false;
  @Output() featureSelected = new EventEmitter<EarthquakeFeature>();
  @Output() platesError = new EventEmitter<string>();

  @ViewChild('mapEl', { static: true }) mapEl!: ElementRef<HTMLDivElement>;

  private theme = inject(ThemeService);
  private http = inject(HttpClient);

  private map?: L.Map;
  private layer?: L.LayerGroup;
  private tiles?: L.TileLayer;
  private markers = new Map<string, L.CircleMarker>();
  private ready = false;

  private platesLayer?: L.GeoJSON;
  private platesData?: GeoJSON.GeoJsonObject;
  private platesLoading = false;

  private readonly LIGHT_TILES =
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  // Dark base WITHOUT labels, with a brighter labels-only overlay on top so
  // country/place names stay legible against the dark map.
  private readonly DARK_TILES =
    'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
  private readonly DARK_LABELS =
    'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png';
  private darkLabels?: L.TileLayer;

  constructor() {
    // Re-skin the basemap whenever the resolved theme flips.
    effect(() => {
      const dark = this.theme.isDark();
      if (this.ready) this.applyBasemap(dark);
    });
  }

  ngAfterViewInit(): void {
    this.map = L.map(this.mapEl.nativeElement, {
      center: [20, 0],
      zoom: 2,
      worldCopyJump: true,
      zoomControl: true,
    });
    this.layer = L.layerGroup().addTo(this.map);
    this.ready = true;
    this.applyBasemap(this.theme.isDark());
    this.render();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.ready) return;
    if (changes['features'] || changes['playbackTime']) this.render();
    if (changes['selectedId']) this.focusSelected();
    if (changes['showPlates']) this.togglePlates(this.showPlates);
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  /** Call after the container is resized (e.g. drawer toggles). */
  invalidate(): void {
    setTimeout(() => this.map?.invalidateSize(), 0);
  }

  private applyBasemap(dark: boolean): void {
    if (!this.map) return;
    if (this.tiles) this.map.removeLayer(this.tiles);
    if (this.darkLabels) {
      this.map.removeLayer(this.darkLabels);
      this.darkLabels = undefined;
    }
    const attribution = '&copy; OpenStreetMap, &copy; CARTO';
    this.tiles = L.tileLayer(dark ? this.DARK_TILES : this.LIGHT_TILES, {
      attribution,
      maxZoom: 19,
    }).addTo(this.map);
    this.tiles.bringToBack();
    if (dark) {
      // Render labels above the markers and brighten them via CSS so place
      // names stay readable over the dark base and the data points.
      this.darkLabels = L.tileLayer(this.DARK_LABELS, {
        maxZoom: 19,
        pane: 'shadowPane',
        className: 'dark-label-tiles',
      }).addTo(this.map);
    }
  }

  private render(): void {
    if (!this.map || !this.layer) return;
    this.layer.clearLayers();
    this.markers.clear();

    const playback = this.playbackTime != null;
    const times = this.features.map((f) => f.properties.time);
    const tMin = times.length ? Math.min(...times) : 0;
    const tMax = this.playbackTime ?? (times.length ? Math.max(...times) : 0);
    const span = Math.max(tMax - tMin, 1);

    const bounds: L.LatLngTuple[] = [];
    for (const f of this.features) {
      const [lon, lat] = f.geometry.coordinates;
      if (lat == null || lon == null) continue;
      const mag = f.properties.mag ?? 0;
      const color = this.magColor(mag);
      // During playback, older events fade and the newest stay bright.
      const opacity = playback ? 0.18 + ((f.properties.time - tMin) / span) * 0.7 : 0.5;
      const marker = L.circleMarker([lat, lon], {
        radius: Math.max(5, mag * 2.6),
        color,
        fillColor: color,
        fillOpacity: opacity,
        opacity: playback ? opacity + 0.15 : 0.9,
        weight: 1.5,
      });
      marker.bindTooltip(
        `<strong>M${mag.toFixed(1)}</strong> — ${f.properties.place ?? 'Unknown'}<br>${new Date(
          f.properties.time,
        ).toUTCString()}`,
      );
      marker.on('click', () => this.featureSelected.emit(f));
      marker.addTo(this.layer);
      this.markers.set(f.id, marker);
      bounds.push([lat, lon]);
    }

    // Keep the viewport stable while scrubbing; only auto-fit on fresh data.
    if (bounds.length && !playback) {
      this.map.fitBounds(L.latLngBounds(bounds).pad(0.1), { maxZoom: 6, animate: false });
    }
  }

  private focusSelected(): void {
    if (!this.map || !this.selectedId) return;
    const marker = this.markers.get(this.selectedId);
    if (!marker) return;
    for (const m of this.markers.values()) m.setStyle({ weight: 1.5 });
    marker.setStyle({ weight: 4 });
    this.map.flyTo(marker.getLatLng(), Math.max(this.map.getZoom(), 6), { duration: 0.6 });
    marker.openTooltip();
  }

  private togglePlates(show: boolean): void {
    if (!this.map) return;
    if (!show) {
      if (this.platesLayer) this.map.removeLayer(this.platesLayer);
      return;
    }
    if (this.platesData) {
      this.addPlatesLayer();
      return;
    }
    if (this.platesLoading) return;
    this.platesLoading = true;
    this.http.get<GeoJSON.GeoJsonObject>(PLATES_URL).subscribe({
      next: (data) => {
        this.platesData = data;
        this.platesLoading = false;
        if (this.showPlates) this.addPlatesLayer();
      },
      error: () => {
        this.platesLoading = false;
        this.platesError.emit('Could not load tectonic plate boundaries.');
      },
    });
  }

  private addPlatesLayer(): void {
    if (!this.map || !this.platesData) return;
    if (!this.platesLayer) {
      this.platesLayer = L.geoJSON(this.platesData, {
        style: { color: '#ff7043', weight: 1.6, opacity: 0.85 },
        interactive: false,
      });
    }
    this.platesLayer.addTo(this.map);
    this.platesLayer.bringToFront();
  }

  private magColor(mag: number): string {
    if (mag >= 7) return '#6a1b9a';
    if (mag >= 6) return '#e53935';
    if (mag >= 5) return '#fb8c00';
    if (mag >= 4) return '#f9a825';
    return '#43a047';
  }
}
