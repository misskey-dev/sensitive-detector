/**
 * 推論の liveness 状態。
 *
 * `detectImage` はタイムアウトしてもスロットを強制返却しない（走り出した tf 推論は中断不能なため
 * 裏で完走させる。詳細は detect.ts）。そのため classify が永続 hung すると、タイムアウト後も
 * スロットが解放されず、最終的に全スロットが詰まってサービスが実質停止する。
 *
 * このトラッカーは「タイムアウト後も未完了のままスロットを保持している推論」の件数を数え、
 * `/health` がその状態を観測できるようにする（＝「外部ヘルスチェックで再起動」という緩和策が
 * 実際に発火できるようにする）。詰まった推論が裏で完了/失敗すれば件数は戻り、自己回復する。
 */
export class InferenceHealth {
  private stuck = 0;
  private readonly maxConcurrent: number;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  /** タイムアウト後もスロットを保持したままの推論を 1 件記録する。 */
  markStuck(): void {
    this.stuck += 1;
  }

  /** 詰まっていた推論が（裏で）完了/失敗したら戻す。 */
  markResolved(): void {
    if (this.stuck > 0) {
      this.stuck -= 1;
    }
  }

  /** 現在「詰まっている」スロット数（診断用）。 */
  get stuckCount(): number {
    return this.stuck;
  }

  /**
   * 全スロットが詰まっており、新規推論を受けられない状態か。
   * `true` の間は `/health` を 503 にして、orchestrator の liveness probe による再起動を促す。
   */
  get saturated(): boolean {
    return this.stuck >= this.maxConcurrent;
  }
}

/**
 * saturated 状態の「連続観測回数」を数え、しきい値に達したら exit すべきと判定する純粋ロジック。
 * 実際の timer 駆動・process.exit は呼び出し側（bootstrap の watchdog）が担う。
 * 一過性のサチュレーション（待機キュー abort 等の極短時間）で誤って exit しないよう、連続観測で確証を取る。
 */
export class SaturationMonitor {
  private consecutive = 0;
  private readonly threshold: number;

  constructor(threshold: number) {
    if (!Number.isInteger(threshold) || threshold < 1) {
      throw new RangeError(`SaturationMonitor threshold must be a positive integer, got ${threshold}`);
    }
    this.threshold = threshold;
  }

  /**
   * 1 回分の観測を反映する。saturated が threshold 回連続したら true（= exit すべき）。
   * saturated でなければ連続カウントを 0 に戻す（自己回復）。
   */
  observe(saturated: boolean): boolean {
    if (!saturated) {
      this.consecutive = 0;
      return false;
    }
    this.consecutive += 1;
    return this.consecutive >= this.threshold;
  }

  /** 現在の連続 saturated 観測回数（ログ・診断用）。 */
  get consecutiveCount(): number {
    return this.consecutive;
  }
}
