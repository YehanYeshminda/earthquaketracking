import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ThemeService, ThemeMode } from './theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, MatToolbarModule, MatIconModule, MatButtonModule, MatMenuModule, MatTooltipModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly title = 'Earthquake Monitor';
  readonly theme = inject(ThemeService);

  themeIcon(): string {
    switch (this.theme.mode()) {
      case 'light': return 'light_mode';
      case 'dark': return 'dark_mode';
      default: return 'brightness_auto';
    }
  }

  setTheme(mode: ThemeMode): void {
    this.theme.set(mode);
  }
}
