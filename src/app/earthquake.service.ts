import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { EarthquakeQuery, EarthquakeResponse } from './earthquake';

@Injectable({ providedIn: 'root' })
export class EarthquakeService {
  private http = inject(HttpClient);
  private readonly baseUrl = 'https://earthquake.usgs.gov/fdsnws/event/1/query';

  query(q: EarthquakeQuery): Observable<EarthquakeResponse> {
    let params = new HttpParams().set('format', 'geojson');
    for (const [key, value] of Object.entries(q)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<EarthquakeResponse>(this.baseUrl, { params });
  }
}
