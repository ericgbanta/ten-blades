// Error types shared across the core.

/**
 * Thrown for an action or query that is not legal in the given state: applyAction
 * on an illegal or malformed action, and forecast on an invalid pairing.
 */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}
