import {
  AfterViewInit,
  Component,
  ElementRef,
  Inject,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EarthquakeFeature } from '../earthquake';
import { ThemeService } from '../theme.service';

const PLANE = 24;
const DEPTH_HEIGHT = 16;

@Component({
  selector: 'app-depth-view',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './depth-view.html',
  styleUrl: './depth-view.scss',
})
export class DepthViewDialog implements AfterViewInit, OnDestroy {
  @ViewChild('host') host?: ElementRef<HTMLDivElement>;

  private theme = inject(ThemeService);

  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private controls?: OrbitControls;
  private frame = 0;
  private observer?: ResizeObserver;
  private disposables: { dispose(): void }[] = [];

  readonly maxDepth: number;
  readonly count: number;

  constructor(
    @Inject(MAT_DIALOG_DATA) public features: EarthquakeFeature[],
    private ref: MatDialogRef<DepthViewDialog>,
  ) {
    const depths = features.map((f) => f.geometry.coordinates[2] ?? 0);
    this.maxDepth = depths.length ? Math.max(...depths, 10) : 0;
    this.count = features.length;
  }

  ngAfterViewInit(): void {
    if (!this.count || !this.host) return;
    this.initScene();
    this.animate();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.controls?.dispose();
    for (const d of this.disposables) d.dispose();
    this.renderer?.dispose();
    if (this.renderer?.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }

  close(): void {
    this.ref.close();
  }

  private initScene(): void {
    if (!this.host) return;
    const el = this.host.nativeElement;
    const width = el.clientWidth || 800;
    const height = el.clientHeight || 500;
    const dark = this.theme.isDark();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(dark ? 0x14141c : 0xf2f2f5);

    this.camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
    this.camera.position.set(0, 16, 30);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(width, height);
    el.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, -DEPTH_HEIGHT / 2, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(10, 25, 15);
    this.scene.add(dir);

    // Surface plane + grid at depth 0.
    const planeGeo = new THREE.PlaneGeometry(PLANE * 1.25, PLANE * 1.25);
    const planeMat = new THREE.MeshBasicMaterial({
      color: dark ? 0x2a3550 : 0x9fb4d8,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    this.scene.add(plane);
    this.track(planeGeo, planeMat);

    const grid = new THREE.GridHelper(
      PLANE * 1.25,
      12,
      dark ? 0x3b4a6b : 0x7f93b8,
      dark ? 0x26314a : 0xc2cee3,
    );
    this.scene.add(grid);
    this.track(grid.geometry, grid.material as THREE.Material);

    this.plotEvents(dark);
  }

  private plotEvents(dark: boolean): void {
    if (!this.scene) return;
    const lons = this.features.map((f) => f.geometry.coordinates[0]);
    const lats = this.features.map((f) => f.geometry.coordinates[1]);
    const lonMid = (Math.min(...lons) + Math.max(...lons)) / 2;
    const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lonRange = Math.max(Math.max(...lons) - Math.min(...lons), 0.01);
    const latRange = Math.max(Math.max(...lats) - Math.min(...lats), 0.01);
    const scale = PLANE / Math.max(lonRange, latRange);

    const lineMat = new THREE.LineBasicMaterial({
      color: dark ? 0x55607a : 0x9aa6c2,
      transparent: true,
      opacity: 0.35,
    });
    this.track(lineMat);

    for (const f of this.features) {
      const [lon, lat, depth] = f.geometry.coordinates;
      const mag = f.properties.mag ?? 0;
      const x = (lon - lonMid) * scale;
      const z = -(lat - latMid) * scale;
      const y = -((depth ?? 0) / this.maxDepth) * DEPTH_HEIGHT;

      const geo = new THREE.SphereGeometry(0.18 + mag * 0.14, 16, 16);
      const mat = new THREE.MeshLambertMaterial({ color: this.depthColor(depth ?? 0) });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      this.track(geo, mat);

      // Drop line from the surface to the hypocenter for depth perception.
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0, z),
        new THREE.Vector3(x, y, z),
      ]);
      this.scene.add(new THREE.Line(lineGeo, lineMat));
      this.track(lineGeo);
    }
  }

  private animate = (): void => {
    this.frame = requestAnimationFrame(this.animate);
    this.controls?.update();
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };

  private resize(): void {
    if (!this.renderer || !this.camera || !this.host) return;
    const el = this.host.nativeElement;
    const width = el.clientWidth;
    const height = el.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private depthColor(depth: number): number {
    if (depth < 70) return 0xef5350; // shallow
    if (depth < 300) return 0xffa726; // intermediate
    return 0x42a5f5; // deep
  }

  private track(...items: { dispose(): void }[]): void {
    this.disposables.push(...items);
  }
}
