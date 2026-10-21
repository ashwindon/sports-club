export type Unsubscribe = () => void;

/** The smallest event channel that does the job: subscribe, unsubscribe, emit. */
export class Emitter<Args extends unknown[]> {
  #listeners = new Set<(...args: Args) => void>();

  on(listener: (...args: Args) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(...args: Args): void {
    for (const listener of this.#listeners) listener(...args);
  }
}
