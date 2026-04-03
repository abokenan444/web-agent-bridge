/**
 * WAB Consent — GDPR/CCPA consent banner for AI agent actions.
 * Loaded after wab.min.js: <script src="/script/wab-consent.js"></script>
 */

export interface WABConsentBannerOptions {
  /** URL to the privacy policy page. */
  policyUrl?: string;
  /** Custom banner message. */
  message?: string;
  /** Called when user clicks Allow. */
  onAccept?: () => void;
  /** Called when user clicks Decline. */
  onDecline?: () => void;
  /** If true (default), skip banner if consent already granted. */
  skipIfGranted?: boolean;
}

export interface WABConsentAPI {
  /** Show the consent banner (skips if already granted unless skipIfGranted is false). */
  showBanner(options?: WABConsentBannerOptions): void;
  /** Returns true if the user has granted consent. */
  hasConsent(): boolean;
  /** Clear stored consent (resets to un-decided). */
  clear(): void;
  /** localStorage key used for persisting consent. */
  STORAGE_KEY: string;
}

declare global {
  interface Window {
    WABConsent: WABConsentAPI;
  }
}

export {};
