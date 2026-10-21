const $ = (id: string) => document.getElementById(id) as HTMLElement;

export type BannerTone = "boundary" | "wicket" | "plain";

/** The broadcast graphics over the 3D view: score bug, speed gun, result banner, and the line about each ball. */
export class Hud {
  readonly #score = $("sb-score");
  readonly #overs = $("sb-overs");
  readonly #oversTotal = $("sb-overs-total");
  readonly #thisOver = $("sb-over");
  readonly #speed = $("sb-speed");
  readonly #speedValue = $("sb-speed-value");
  readonly #banner = $("banner");
  readonly #bannerMain = $("banner-main");
  readonly #bannerSub = $("banner-sub");
  readonly #delivery = $("delivery");

  score(runs: number, wickets: number, balls: number, overs: number, thisOver: string[]): void {
    this.#score.textContent = `${runs}/${wickets}`;
    this.#overs.textContent = `${Math.floor(balls / 6)}.${balls % 6}`;
    this.#oversTotal.textContent = ` / ${overs} OV`;
    this.#thisOver.replaceChildren(
      ...thisOver.map((ball) => {
        const chip = document.createElement("span");
        chip.textContent = ball;
        chip.dataset.ball = ball;
        return chip;
      }),
    );
  }

  /** The speed gun reading for the ball just bowled, or nothing. */
  speed(kmh: number | undefined): void {
    this.#speed.hidden = kmh === undefined;
    this.#speedValue.textContent = kmh === undefined ? "" : String(kmh);
  }

  banner(main: string, sub = "", tone: BannerTone = "plain"): void {
    this.#bannerMain.textContent = main;
    this.#bannerSub.textContent = sub;
    this.#bannerSub.hidden = sub === "";
    this.#banner.dataset.tone = tone;
    this.#banner.hidden = false;
    // Restart the entrance animation.
    this.#banner.classList.remove("show");
    void this.#banner.offsetWidth;
    this.#banner.classList.add("show");
  }

  clearBanner(): void {
    this.#banner.hidden = true;
  }

  delivery(text: string): void {
    this.#delivery.textContent = text;
  }
}
