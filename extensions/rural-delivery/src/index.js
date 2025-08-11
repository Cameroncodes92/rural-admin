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
 * The configured entrypoint for the 'cart.delivery-options.transform.run' target.
 * Implements rural filtering logic per requirements.
 * @param {RunInput} input
 * @returns {CartDeliveryOptionsTransformRunResult}
 */
export function cartDeliveryOptionsTransformRun(input) {
  const config = parseConfiguration(input);
  const enabled = Boolean(config.enabled);
  if (!enabled) return NO_CHANGES;

  // Read configured lists independently
  const configuredCountryCodes = normalize(Array.isArray(config.countryCodes) ? config.countryCodes : []);
  const configuredPostcodes = normalize(Array.isArray(config.postcodes) ? config.postcodes : []);
  const methodsToKeep = normalize(config.ruralMethodsToKeep);

  const groups = input?.cart?.deliveryGroups || [];
  if (groups.length === 0) return NO_CHANGES;

  // Consider first delivery group for address context (common in examples)
  const destinationAddress = groups[0]?.deliveryAddress || {};
  const destinationCountry = destinationAddress?.countryCode;
  const destinationZip = destinationAddress?.zip;

  // Determine rural status by either configured country codes OR specific postcodes
  const isRuralByCountry =
    configuredCountryCodes.length > 0 &&
    destinationCountry &&
    configuredCountryCodes.includes(String(destinationCountry).trim().toLowerCase());

  const isRuralByPostcode =
    configuredPostcodes.length > 0 &&
    destinationZip &&
    configuredPostcodes.includes(String(destinationZip).trim().toLowerCase());

  const isRural = isRuralByCountry || isRuralByPostcode;
  if (!isRural) return NO_CHANGES;

  // For rural addresses: hide any option not in allowlist by handle or title
  const operations = [];
  for (const group of groups) {
    const options = group?.deliveryOptions || [];
    for (const option of options) {
      const handle = String(option?.handle || "").toLowerCase();
      const title = String(option?.title || "").toLowerCase();
      const keep = methodsToKeep.includes(handle) || methodsToKeep.includes(title);
      if (!keep && handle) {
        operations.push({
          deliveryOptionHide: { deliveryOptionHandle: option.handle },
        });
      }
    }
  }

  return { operations };
}


