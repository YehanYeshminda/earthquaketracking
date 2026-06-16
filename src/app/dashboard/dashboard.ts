import {
  Component,
  computed,
  inject,
  signal,
  ViewChild,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatDividerModule } from '@angular/material/divider';
import { MatBadgeModule } from '@angular/material/badge';
import { MatSliderModule } from '@angular/material/slider';

import { EarthquakeService } from '../earthquake.service';
import { EarthquakeFeature, EarthquakeQuery } from '../earthquake';
import { EarthquakeDetailDialog } from '../earthquake-detail/earthquake-detail';
import { EarthquakeMap } from '../earthquake-map/earthquake-map';
import { DepthViewDialog } from '../depth-view/depth-view';

interface BoundingBox {
  name: string;
  minlat: number;
  maxlat: number;
  minlon: number;
  maxlon: number;
}

const REGION_PRESETS: BoundingBox[] = [
  { name: 'Worldwide', minlat: -90, maxlat: 90, minlon: -180, maxlon: 180 },
  { name: 'Pacific Ring of Fire', minlat: -60, maxlat: 65, minlon: 110, maxlon: -70 },
  { name: 'Japan', minlat: 24, maxlat: 46, minlon: 122, maxlon: 146 },
  { name: 'California', minlat: 32, maxlat: 42, minlon: -125, maxlon: -114 },
  { name: 'Indonesia', minlat: -11, maxlat: 6, minlon: 95, maxlon: 141 },
  { name: 'Mediterranean', minlat: 30, maxlat: 47, minlon: -10, maxlon: 40 },
  { name: 'South America (Andes)', minlat: -55, maxlat: 12, minlon: -82, maxlon: -34 },
];

type SortKey = 'time' | 'time-asc' | 'magnitude' | 'magnitude-asc';

interface FilterModel {
  start: Date;
  end: Date;
  minMag: number;
  maxMag: number | null;
  orderby: SortKey;
  limit: number;
  useRegion: boolean;
  minlat: number | null;
  maxlat: number | null;
  minlon: number | null;
  maxlon: number | null;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatChipsModule,
    MatTooltipModule,
    MatDialogModule,
    MatSlideToggleModule,
    MatExpansionModule,
    MatSidenavModule,
    MatDividerModule,
    MatBadgeModule,
    MatSliderModule,
    EarthquakeMap,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements AfterViewInit, OnDestroy {
  private svc = inject(EarthquakeService);
  private snack = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  @ViewChild('filterDrawer') filterDrawer!: MatSidenav;
  @ViewChild(EarthquakeMap) mapCmp?: EarthquakeMap;

  loading = signal(false);
  features = signal<EarthquakeFeature[]>([]);
  lastUpdated = signal<Date | null>(null);
  selectedId = signal<string | null>(null);
  listFilter = signal('');

  autoRefresh = signal(false);
  refreshInterval = signal(60);
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  // Map overlays / views
  showPlates = signal(false);

  // Timeline playback
  playbackMode = signal(false);
  playing = signal(false);
  cursor = signal(0);
  playbackSpeed = signal(1);
  private playTimer: ReturnType<typeof setInterval> | null = null;

  readonly regionPresets = REGION_PRESETS;

  readonly today = new Date();
  filter: FilterModel = this.defaultFilter();

  /** Full time span of the current result set. */
  timeRange = computed(() => {
    const list = this.features();
    if (!list.length) return { min: 0, max: 0 };
    const times = list.map((f) => f.properties.time);
    return { min: Math.min(...times), max: Math.max(...times) };
  });

  /** Events shown on the map: clipped to the playback cursor when active. */
  mapFeatures = computed(() => {
    if (!this.playbackMode()) return this.features();
    const c = this.cursor();
    return this.features().filter((f) => f.properties.time <= c);
  });

  /** Map features after the list's place text filter (drives the list). */
  visibleFeatures = computed(() => {
    const term = this.listFilter().trim().toLowerCase();
    let list = this.mapFeatures();
    if (term) {
      list = list.filter((f) => (f.properties.place ?? '').toLowerCase().includes(term));
    }
    return list;
  });

  stats = computed(() => {
    const list = this.features();
    if (!list.length) return { total: 0, avgMag: 0, maxMag: 0, tsunami: 0, alerts: 0 };
    const mags = list.map((f) => f.properties.mag ?? 0);
    return {
      total: list.length,
      avgMag: mags.reduce((a, b) => a + b, 0) / list.length,
      maxMag: Math.max(...mags),
      tsunami: list.filter((f) => f.properties.tsunami === 1).length,
      alerts: list.filter((f) => !!f.properties.alert).length,
    };
  });

  ngAfterViewInit(): void {
    this.search();
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.stopPlay();
  }

  search(): void {
    this.loading.set(true);
    const q: EarthquakeQuery = {
      starttime: this.fmtDate(this.filter.start),
      endtime: this.fmtDate(this.filter.end),
      minmagnitude: this.filter.minMag,
      maxmagnitude: this.filter.maxMag ?? undefined,
      orderby: this.filter.orderby,
      limit: this.filter.limit,
    };
    if (this.filter.useRegion) {
      if (this.filter.minlat != null) q.minlatitude = this.filter.minlat;
      if (this.filter.maxlat != null) q.maxlatitude = this.filter.maxlat;
      if (this.filter.minlon != null) q.minlongitude = this.filter.minlon;
      if (this.filter.maxlon != null) q.maxlongitude = this.filter.maxlon;
    }
    this.svc.query(q).subscribe({
      next: (resp) => {
        this.features.set(resp.features);
        this.lastUpdated.set(new Date());
        this.loading.set(false);
        if (this.playbackMode()) this.cursor.set(this.timeRange().min);
      },
      error: (err) => {
        this.loading.set(false);
        this.snack.open(`Failed to load: ${err.message}`, 'Dismiss', { duration: 5000 });
      },
    });
  }

  applyAndClose(): void {
    this.search();
    this.filterDrawer?.close();
  }

  resetFilters(): void {
    this.filter = this.defaultFilter();
    this.search();
  }

  applyRegionPreset(p: BoundingBox): void {
    this.filter.useRegion = true;
    this.filter.minlat = p.minlat;
    this.filter.maxlat = p.maxlat;
    this.filter.minlon = p.minlon;
    this.filter.maxlon = p.maxlon;
  }

  selectFeature(f: EarthquakeFeature): void {
    this.selectedId.set(f.id);
  }

  openDetail(f: EarthquakeFeature): void {
    this.selectedId.set(f.id);
    this.dialog.open(EarthquakeDetailDialog, { data: f, width: '600px' });
  }

  toggleFilters(): void {
    this.filterDrawer?.toggle();
    this.mapCmp?.invalidate();
  }

  togglePlates(): void {
    this.showPlates.update((v) => !v);
  }

  onPlatesError(msg: string): void {
    this.showPlates.set(false);
    this.snack.open(msg, 'Dismiss', { duration: 4000 });
  }

  openDepthView(): void {
    if (!this.features().length) {
      this.snack.open('No events to plot in 3D.', 'Dismiss', { duration: 3000 });
      return;
    }
    this.dialog.open(DepthViewDialog, {
      data: this.features(),
      maxWidth: '95vw',
      panelClass: 'depth-dialog',
    });
  }

  // ---------- Timeline playback ----------
  togglePlayback(): void {
    if (this.playbackMode()) {
      this.exitPlayback();
    } else {
      this.playbackMode.set(true);
      this.cursor.set(this.timeRange().min);
    }
  }

  exitPlayback(): void {
    this.stopPlay();
    this.playbackMode.set(false);
  }

  togglePlay(): void {
    if (this.playing()) {
      this.stopPlay();
    } else {
      this.startPlay();
    }
  }

  onScrub(value: number): void {
    this.cursor.set(value);
  }

  cycleSpeed(): void {
    const speeds = [1, 2, 4, 8];
    const next = speeds[(speeds.indexOf(this.playbackSpeed()) + 1) % speeds.length];
    this.playbackSpeed.set(next);
    if (this.playing()) this.startPlay();
  }

  private startPlay(): void {
    const { min, max } = this.timeRange();
    if (max <= min) return;
    // Restart from the beginning if we're already at the end.
    if (this.cursor() >= max) this.cursor.set(min);
    this.stopPlay();
    this.playing.set(true);
    const step = ((max - min) / 300) * this.playbackSpeed();
    this.playTimer = setInterval(() => {
      const next = this.cursor() + step;
      if (next >= max) {
        this.cursor.set(max);
        this.stopPlay();
      } else {
        this.cursor.set(next);
      }
    }, 50);
  }

  private stopPlay(): void {
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
    this.playing.set(false);
  }

  toggleAutoRefresh(enabled: boolean): void {
    this.autoRefresh.set(enabled);
    if (enabled) this.startPolling();
    else this.stopPolling();
  }

  onIntervalChange(seconds: number): void {
    this.refreshInterval.set(seconds);
    if (this.autoRefresh()) this.startPolling();
  }

  exportCsv(): void {
    const rows = this.features();
    if (!rows.length) {
      this.snack.open('No data to export.', 'Dismiss', { duration: 3000 });
      return;
    }
    const header = [
      'id', 'time_utc', 'magnitude', 'mag_type', 'place', 'latitude', 'longitude',
      'depth_km', 'alert', 'tsunami', 'felt', 'sig', 'status', 'url',
    ];
    const lines = [header.join(',')];
    for (const f of rows) {
      const p = f.properties;
      const [lon, lat, depth] = f.geometry.coordinates;
      lines.push([
        f.id,
        new Date(p.time).toISOString(),
        p.mag ?? '',
        p.magType ?? '',
        this.csvEscape(p.place ?? ''),
        lat, lon, depth,
        p.alert ?? '',
        p.tsunami,
        p.felt ?? '',
        p.sig,
        p.status,
        p.url,
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `earthquakes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  magColor(mag: number | null): string {
    const m = mag ?? 0;
    if (m >= 7) return '#6a1b9a';
    if (m >= 6) return '#e53935';
    if (m >= 5) return '#fb8c00';
    if (m >= 4) return '#f9a825';
    return '#43a047';
  }

  formatTick = (value: number): string => {
    const d = new Date(value);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
  };

  relativeTime(ms: number): string {
    const diff = Date.now() - ms;
    const min = Math.round(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const day = Math.round(hr / 24);
    return `${day} day${day === 1 ? '' : 's'} ago`;
  }

  private startPolling(): void {
    this.stopPolling();
    this.refreshTimer = setInterval(() => this.search(), this.refreshInterval() * 1000);
  }

  private stopPolling(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private defaultFilter(): FilterModel {
    return {
      start: this.daysAgo(7),
      end: new Date(),
      minMag: 4.5,
      maxMag: null,
      orderby: 'time',
      limit: 200,
      useRegion: false,
      minlat: null,
      maxlat: null,
      minlon: null,
      maxlon: null,
    };
  }

  private csvEscape(s: string): string {
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  private fmtDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }
}
