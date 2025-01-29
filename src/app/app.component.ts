import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  linkedSignal,
  model,
  signal,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideUpload, lucidePlay, lucidePause } from '@ng-icons/lucide';
import Chart from 'chart.js/auto';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputNumberModule } from 'primeng/inputnumber';
import { interval, Subject, switchMap, tap } from 'rxjs';

@Component({
  imports: [FormsModule, NgIcon, ButtonModule, CardModule, InputNumberModule],
  providers: [provideIcons({ lucideUpload, lucidePlay, lucidePause })],
  selector: 'app-root',
  templateUrl: 'app.component.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements AfterViewInit {
  readonly chartEl = viewChild.required<ElementRef<HTMLCanvasElement>>('chart');

  readonly fileName = signal<string>('');

  readonly windowSize = model<number>(50);
  readonly windowStart = model<number>(0);
  readonly stepInterval = model<number>(500);
  readonly stepSize = model<number>(10);

  readonly chartData = computed(() => {
    if (this.#dataPoints()?.length) {
      const xAxisData = [];
      const yAxisData = [];

      let step = this.#curStep();
      let min = this.#dataPoints()[step][1];
      let max = min;
      let sum = 0;

      for (let i = 0; i < this.windowSize(); i++) {
        const [x, y] = this.#dataPoints()[step];
        if (y < min) {
          min = y;
        }
        if (y > max) {
          max = y;
        }
        xAxisData.push(x);
        yAxisData.push(y);
        sum += y;
        step += this.stepSize();
      }

      const avg = sum / this.windowSize();
      const moeUpperBounds = [];
      const moeLowerBounds = [];
      let squaredDiffSum = 0;

      for (let i = 0; i < yAxisData.length; i++) {
        squaredDiffSum += Math.pow(yAxisData[i] - avg, 2);
        const moe = yAxisData[i] * 0.1;
        moeUpperBounds.push(yAxisData[i] + moe);
        moeLowerBounds.push(yAxisData[i] - moe);
      }
      return {
        xAxisData,
        yAxisData,
        moeUpperBounds,
        moeLowerBounds,
        min,
        max,
        avg,
        var: squaredDiffSum / this.windowSize(),
      };
    }
    return {
      xAxisData: [],
      yAxisData: [],
      moeUpperBounds: [],
      moeLowerBounds: [],
      min: 0,
      max: 0,
      avg: 0,
      var: 0,
    };
  });

  readonly playing = signal<boolean>(false);

  readonly #dataPoints = signal<number[][]>([]);
  readonly #curStep = linkedSignal<number>(() => this.windowStart());
  readonly #stepSize$ = toObservable(this.stepSize);

  readonly #intervalSettings = computed(() => ({
    stepInterval: this.stepInterval(),
    playing: this.playing(),
  }));
  readonly #interval$ = toObservable(this.#intervalSettings).pipe(
    switchMap(({ playing, stepInterval }) => {
      if (playing) {
        return interval(stepInterval);
      }
      return new Subject<number>();
    }),
  );

  #chart: Chart | null = null;

  constructor() {
    this.#listenToIntervalChanges();
    this.#listenToChartDataChanges();
  }

  ngAfterViewInit(): void {
    this.#initChart();
  }

  async onFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.fileName.set(file.name);
      const csv = (await file.text()).trim();
      const dataPoints = csv
        .split('\n')
        .map((i) => i.split(',').map((i) => Number(i)));
      this.#dataPoints.set(dataPoints);
    }
  }

  togglePlaying(): void {
    this.playing.update((playing) => !playing);
  }

  #initChart(): void {
    this.#chart = new Chart(this.chartEl().nativeElement, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Original Series',
            data: [],
            fill: false,
            borderColor: '#fbbf24',
            borderWidth: 2,
            tension: 0.5,
          },
          {
            label: 'MOE Upper Bounds',
            data: [],
            borderColor: '#fef3c7',
            tension: 0.5,
            fill: '-1',
          },
          {
            label: 'MOE Lower Bounds',
            data: [],
            borderColor: '#fef3c7',
            tension: 0.5,
            fill: '-1',
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
          },
        },
        plugins: {
          legend: {
            display: false,
          },
        },
      },
    });
  }

  #listenToIntervalChanges(): void {
    this.#interval$
      .pipe(
        switchMap(() => this.#stepSize$),
        tap((stepSize) => this.#curStep.update((step) => step + stepSize)),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  #listenToChartDataChanges(): void {
    toObservable(this.chartData)
      .pipe(
        tap(({ xAxisData, yAxisData, moeUpperBounds, moeLowerBounds }) => {
          if (this.#chart) {
            this.#chart.data.labels = xAxisData;
            this.#chart.data.datasets[0].data = yAxisData;
            this.#chart.data.datasets[1].data = moeUpperBounds;
            this.#chart.data.datasets[2].data = moeLowerBounds;
            this.#chart.update();
          }
        }),
        takeUntilDestroyed(),
      )
      .subscribe();
  }
}
