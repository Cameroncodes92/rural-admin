import { describe, it, expect } from 'vitest';
import { cartDeliveryOptionsTransformRun } from '../src/index';

describe('rural delivery customization', () => {
  it('returns no operations when config metafield missing (empty config)', () => {
    const result = cartDeliveryOptionsTransformRun({
      deliveryCustomization: { metafield: null },
      cart: { deliveryGroups: [{ deliveryAddress: { countryCode: 'US' }, deliveryOptions: [] }] }
    });
    expect(result).toEqual({ operations: [] });
  });

  it('returns no operations when disabled', () => {
    const result = cartDeliveryOptionsTransformRun({
      deliveryCustomization: { metafield: { value: JSON.stringify({ enabled: false }) } },
      cart: { deliveryGroups: [{ deliveryAddress: { countryCode: 'US' }, deliveryOptions: [] }] }
    });
    expect(result).toEqual({ operations: [] });
  });

  it('returns no operations for non-rural country', () => {
    const input = {
      deliveryCustomization: {
        metafield: {
          value: JSON.stringify({
            enabled: true,
            countryCodes: ['NZ', 'CA'],
            ruralMethodsToKeep: ['rural courier', 'rural-courier']
          })
        }
      },
      cart: {
        deliveryGroups: [
          {
            deliveryAddress: { countryCode: 'US' },
            deliveryOptions: [
              { handle: 'standard', title: 'Standard' },
              { handle: 'express', title: 'Express' }
            ]
          }
        ]
      }
    };
    const result = cartDeliveryOptionsTransformRun(input);
    expect(result).toEqual({ operations: [] });
  });

  it('hides all options except the configured rural ones by handle or title', () => {
    const input = {
      deliveryCustomization: {
        metafield: {
          value: JSON.stringify({
            enabled: true,
            countryCodes: ['NZ', 'AU'],
            ruralMethodsToKeep: ['rural-courier', 'rural courier']
          })
        }
      },
      cart: {
        deliveryGroups: [
          {
            deliveryAddress: { countryCode: 'NZ' },
            deliveryOptions: [
              { handle: 'rural-courier', title: 'Rural Courier' },
              { handle: 'standard', title: 'Standard' },
              { handle: 'express', title: 'Express' }
            ]
          }
        ]
      }
    };

    const result = cartDeliveryOptionsTransformRun(input);
    expect(result).toEqual({
      operations: [
        { deliveryOptionHide: { deliveryOptionHandle: 'standard' } },
        { deliveryOptionHide: { deliveryOptionHandle: 'express' } }
      ]
    });
  });

  it('treats keep list case-insensitively and matches by title as well', () => {
    const input = {
      deliveryCustomization: {
        metafield: {
          value: JSON.stringify({
            enabled: true,
            countryCodes: ['US'],
            ruralMethodsToKeep: ['rural special']
          })
        }
      },
      cart: {
        deliveryGroups: [
          {
            deliveryAddress: { countryCode: 'US' },
            deliveryOptions: [
              { handle: 'keep-by-title', title: 'Rural Special' },
              { handle: 'drop-1', title: 'Other' }
            ]
          }
        ]
      }
    };
    const result = cartDeliveryOptionsTransformRun(input);
    expect(result).toEqual({
      operations: [
        { deliveryOptionHide: { deliveryOptionHandle: 'drop-1' } }
      ]
    });
  });

  it('treats address as rural based on postcode match when country does not match', () => {
    const input = {
      deliveryCustomization: {
        metafield: {
          value: JSON.stringify({
            enabled: true,
            countryCodes: ['AU'],
            postcodes: ['9013', '9015'],
            ruralMethodsToKeep: ['international shipping', 'rural shipping']
          })
        }
      },
      cart: {
        deliveryGroups: [
          {
            deliveryAddress: { countryCode: 'NZ', zip: '9013' },
            deliveryOptions: [
              { handle: 'international shipping', title: 'International Shipping' },
              { handle: 'standard', title: 'Standard' }
            ]
          }
        ]
      }
    };

    const result = cartDeliveryOptionsTransformRun(input);
    expect(result).toEqual({
      operations: [
        { deliveryOptionHide: { deliveryOptionHandle: 'standard' } }
      ]
    });
  });
});


