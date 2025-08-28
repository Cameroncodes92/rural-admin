// @ts-check

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").CartDeliveryOptionsTransformRunResult} CartDeliveryOptionsTransformRunResult
 */

/**
 * @type {CartDeliveryOptionsTransformRunResult}
 */
const NO_CHANGES = { operations: [] };

/**
 * Parse the configuration JSON from metafield value or jsonValue shapes.
 * Supports shape: { enabled:boolean, countryCodes?:string[], postcodes?:string[], ruralMethodsToKeep:string[] }
 * @param {any} input
 */
function parseConfiguration(input) {
  const raw = input?.deliveryCustomization?.metafield;
  if (!raw) return {};
  // value (string) for JS input query examples using value
  if (typeof raw.value === "string") {
    try { return JSON.parse(raw.value); } catch { return {}; }
  }
  // jsonValue (object) when using jsonValue in query
  if (raw.jsonValue && typeof raw.jsonValue === "object") {
    return raw.jsonValue;
  }
  return {};
}

/**
 * Normalize a list of strings: lowercase + trim for robust matching
 * @param {string[]|undefined} list
 */
function normalize(list) {
  return Array.isArray(list) ? list.map((s) => String(s).trim().toLowerCase()) : [];
}

/**
 * Normalize a postcode by lowercasing and removing non-alphanumeric chars
 * @param {string|undefined|null} s
 */
function normalizeZip(s) {
  if (!s) return "";
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

/**
 * Expand and normalize configured postcode entries. Handles entries that
 * accidentally contain multiple postcodes separated by spaces/dots/hyphens/etc.
 * @param {string[]|undefined} entries
 */
function expandNormalizedPostcodes(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const entry of entries) {
    const parts = String(entry)
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((p) => normalizeZip(p))
      .filter(Boolean);
    out.push(...parts);
  }
  return out;
}

/**
 * The configured entrypoint for the 'cart.delivery-options.transform.run' target.
 * Implements rural filtering logic per requirements.
 * @param {RunInput} input
 * @returns {CartDeliveryOptionsTransformRunResult}
 */
export function cartDeliveryOptionsTransformRun(input) {
  const config = parseConfiguration(input);
  const enabled = Boolean(config.enabled);
  if (!enabled) return NO_CHANGES;

  // Read configured lists (postcode-only activation; country codes ignored)
  const configuredPostcodes = expandNormalizedPostcodes(Array.isArray(config.postcodes) ? config.postcodes : []);
  const methodsToKeep = normalize(config.ruralMethodsToKeep);

  const groups = input?.cart?.deliveryGroups || [];
  if (groups.length === 0) return NO_CHANGES;

  // Consider first delivery group for address context (common in examples)
  const destinationAddress = groups[0]?.deliveryAddress || {};
  const destinationCountry = destinationAddress?.countryCode;
  const destinationZip = normalizeZip(destinationAddress?.zip);

  // Determine rural status by configured postcodes only
  const isRural =
    configuredPostcodes.length > 0 &&
    destinationZip &&
    configuredPostcodes.includes(destinationZip);

  // If there are no configured methods to keep, do nothing to avoid hiding all options inadvertently
  if (methodsToKeep.length === 0) return NO_CHANGES;

  // Behavior:
  // - Non-rural (default): hide keep-list options so they're not available
  // - Rural (postcode match): hide all options NOT in the keep list
  const operations = [];
  for (const group of groups) {
    const options = group?.deliveryOptions || [];
    // If rural: check if there will be at least one keep option; if not, skip hiding to avoid zero-rate checkout
    if (isRural) {
      const hasAtLeastOneKeep = options.some((option) => {
        const handle = String(option?.handle || "").toLowerCase();
        const title = String(option?.title || "").toLowerCase();
        return methodsToKeep.includes(handle) || methodsToKeep.includes(title);
      });
      if (!hasAtLeastOneKeep) {
        // Nothing matches keep list; don't hide anything to prevent no-shipping scenario
        continue;
      }
    }

    for (const option of options) {
      const handle = String(option?.handle || "").toLowerCase();
      const title = String(option?.title || "").toLowerCase();
      const isKeepMethod = methodsToKeep.includes(handle) || methodsToKeep.includes(title);

      const shouldHide = isRural ? !isKeepMethod : isKeepMethod;
      if (shouldHide && handle) operations.push({ deliveryOptionHide: { deliveryOptionHandle: option.handle } });
    }
  }

  return { operations };
}


