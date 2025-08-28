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

  it('hides keep-list methods by default when postcode does not match (non-rural)', () => {
    const input = {
      deliveryCustomization: {
        metafield: {
          value: JSON.stringify({
            enabled: true,
            postcodes: ['9999'],
            ruralMethodsToKeep: ['rural courier', 'rural-courier']
          })
        }
      },
      cart: {
        deliveryGroups: [
          {
            deliveryAddress: { countryCode: 'US', zip: '10001' },
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
        { deliveryOptionHide: { deliveryOptionHandle: 'rural-courier' } }
      ]
    });
  });

  it('hides all non-keep options when postcode matches (rural active)', () => {
    const input = {
      deliveryCustomization: {
        metafield: {
          value: JSON.stringify({
            enabled: true,
            postcodes: ['9010', '9020'],
            ruralMethodsToKeep: ['rural-courier', 'rural courier']
          })
        }
      },
      cart: {
        deliveryGroups: [
          {
            deliveryAddress: { countryCode: 'NZ', zip: '9010' },
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

  it('treats keep list case-insensitively and matches by title as well (rural active)', () => {
    const input = {
      deliveryCustomization: {
        metafield: {
          value: JSON.stringify({
            enabled: true,
            postcodes: ['10001'],
            ruralMethodsToKeep: ['rural special']
          })
        }
      },
      cart: {
        deliveryGroups: [
          {
            deliveryAddress: { countryCode: 'US', zip: '10001' },
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

  it('activates rural by postcode match regardless of country', () => {
    const input = {
      deliveryCustomization: {
        metafield: {
          value: JSON.stringify({
            enabled: true,
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

  it('handles malformed metafield postcodes like "9013. 9012" and matches 9013', () => {
    const input = {
      deliveryCustomization: {
        metafield: {
          value: JSON.stringify({
            enabled: true,
            postcodes: ["9013. 9012"],
            ruralMethodsToKeep: ['rural shipping']
          })
        }
      },
      cart: {
        deliveryGroups: [
          {
            deliveryAddress: { countryCode: 'NZ', zip: '9013' },
            deliveryOptions: [
              { handle: 'international', title: 'International Shipping' },
              { handle: 'standard', title: 'Standard' },
              { handle: 'rural', title: 'Rural Shipping' }
            ]
          }
        ]
      }
    };
    const result = cartDeliveryOptionsTransformRun(input);
    expect(result).toEqual({
      operations: [
        { deliveryOptionHide: { deliveryOptionHandle: 'international' } },
        { deliveryOptionHide: { deliveryOptionHandle: 'standard' } }
      ]
    });
  });

  it('when rural but no keep methods exist in options, do not hide anything (fallback)', () => {
    const input = {
      deliveryCustomization: {
        metafield: {
          value: JSON.stringify({
            enabled: true,
            postcodes: ['9013'],
            ruralMethodsToKeep: ['rural shipping']
          })
        }
      },
      cart: {
        deliveryGroups: [
          {
            deliveryAddress: { countryCode: 'NZ', zip: '9013' },
            deliveryOptions: [
              { handle: 'intl', title: 'International Shipping' },
              { handle: 'standard', title: 'Standard' }
            ]
          }
        ]
      }
    };
    const result = cartDeliveryOptionsTransformRun(input);
    expect(result).toEqual({ operations: [] });
  });
  
  it('returns no operations when keep list is empty to avoid hiding everything', () => {
    const input = {
      deliveryCustomization: {
        metafield: {
          value: JSON.stringify({
            enabled: true,
            postcodes: ['90210'],
            ruralMethodsToKeep: []
          })
        }
      },
      cart: {
        deliveryGroups: [
          {
            deliveryAddress: { countryCode: 'US', zip: '90210' },
            deliveryOptions: [
              { handle: 'standard', title: 'Standard' }
            ]
          }
        ]
      }
    };
    const result = cartDeliveryOptionsTransformRun(input);
    expect(result).toEqual({ operations: [] });
  });
});


