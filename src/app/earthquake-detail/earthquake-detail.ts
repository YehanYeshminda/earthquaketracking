import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { EarthquakeFeature } from '../earthquake';

@Component({
  selector: 'app-earthquake-detail',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatDividerModule, MatChipsModule],
  templateUrl: './earthquake-detail.html',
  styleUrl: './earthquake-detail.scss',
})
export class EarthquakeDetailDialog {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: EarthquakeFeature,
    private ref: MatDialogRef<EarthquakeDetailDialog>,
  ) {}

  get props() { return this.data.properties; }
  get coords() { return this.data.geometry.coordinates; }

  close() { this.ref.close(); }
}
