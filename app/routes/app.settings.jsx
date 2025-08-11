import { useEffect, useState } from "react";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Checkbox,
  BlockStack,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const APP_NAMESPACE = "rural_shipping";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 1) Try to find an existing customization created by this app
  const listResp = await admin.graphql(
    `#graphql
      query GetCustomizations {
        deliveryCustomizations(first: 100) {
          edges {
            node {
              id
              enabled
              shopifyFunction { id apiType appKey title }
              metafield(namespace: "${APP_NAMESPACE}", key: "config") {
                value
              }
            }
          }
        }
      }
    `,
  );
  const listJson = await listResp.json();
  const nodes = listJson?.data?.deliveryCustomizations?.edges?.map((e) => e.node) ?? [];
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  let customization = nodes.find(
    (n) => n?.shopifyFunction?.apiType === "delivery_customization" && n?.shopifyFunction?.appKey === apiKey && n.enabled,
  );
  if (!customization) {
    customization = nodes.find(
      (n) => n?.shopifyFunction?.apiType === "delivery_customization" && n?.shopifyFunction?.appKey === apiKey,
    );
  }

  // 2) Lazily create if missing
  if (!customization) {
    const fnResp = await admin.graphql(
      `#graphql
        query ListFunctions { shopifyFunctions(first: 50) { nodes { id apiType title appKey } } }
      `,
    );
    const fnJson = await fnResp.json();
    const fnNodes = fnJson?.data?.shopifyFunctions?.nodes ?? [];
    const deliveryFn =
      fnNodes.find((f) => f.apiType === "delivery_customization" && f.appKey === apiKey) ||
      fnNodes.find((f) => f.apiType === "delivery_customization");

    if (deliveryFn?.id) {
      const createResp = await admin.graphql(
        `#graphql
          mutation CreateCustomization($input: DeliveryCustomizationInput!) {
            deliveryCustomizationCreate(deliveryCustomization: $input) {
              deliveryCustomization { id enabled }
              userErrors { message }
            }
          }
        `,
        {
          variables: {
            input: {
              functionId: deliveryFn.id,
              title: "Rural Delivery",
              enabled: true,
            },
          },
        },
      );
      const createJson = await createResp.json();
      const created = createJson?.data?.deliveryCustomizationCreate?.deliveryCustomization;
      if (created?.id) {
        customization = { id: created.id, enabled: created.enabled };
      }
    }
  }

  // Defaults if nothing yet
  const defaults = {
    enabled: Boolean(customization?.enabled) || false,
    postcodes: [],
    ruralMethodsToKeep: [],
    customizationId: customization?.id || null,
  };

  const rawValue = customization?.metafield?.value;
  if (rawValue) {
    try {
      const parsed = JSON.parse(rawValue);
      defaults.enabled = Boolean(parsed.enabled);
      if (Array.isArray(parsed.postcodes)) defaults.postcodes = parsed.postcodes;
      if (Array.isArray(parsed.countryCodes)) defaults.postcodes = parsed.countryCodes; // backward compat mapping
      if (Array.isArray(parsed.ruralMethodsToKeep)) defaults.ruralMethodsToKeep = parsed.ruralMethodsToKeep;
    } catch {}
  }

  return json({
    customizationId: defaults.customizationId,
    enabled: defaults.enabled,
    postcodesText: defaults.postcodes.join(", "),
    ruralMethodsToKeepText: defaults.ruralMethodsToKeep.join(", "),
  });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  // Parse fields
  const enabled = String(formData.get("enabled")) === "true";
  const postcodesInput = String(formData.get("postcodes") || "");
  const methodsInput = String(formData.get("ruralMethodsToKeep") || "");
  const customizationId = String(formData.get("customizationId") || "");

  const toList = (s) =>
    s
      .split(/[\n,]/)
      .map((t) => t.trim())
      .filter(Boolean);

  const postcodes = toList(postcodesInput);
  const ruralMethodsToKeep = toList(methodsInput).map((t) => t.toLowerCase());

  // Ensure we have a customization to write to; create if missing
  let ownerId = customizationId || null;
  if (!ownerId) {
    const apiKey = process.env.SHOPIFY_API_KEY || "";
    const fnResp = await admin.graphql(
      `#graphql
        query ListFunctions { shopifyFunctions(first: 50) { nodes { id apiType title appKey } } }
      `,
    );
    const fnJson = await fnResp.json();
    const fnNodes = fnJson?.data?.shopifyFunctions?.nodes ?? [];
    const deliveryFn =
      fnNodes.find((f) => f.apiType === "delivery_customization" && f.appKey === apiKey) ||
      fnNodes.find((f) => f.apiType === "delivery_customization");
    if (deliveryFn?.id) {
      const createResp = await admin.graphql(
        `#graphql
          mutation CreateCustomization($input: DeliveryCustomizationInput!) {
            deliveryCustomizationCreate(deliveryCustomization: $input) {
              deliveryCustomization { id enabled }
              userErrors { message }
            }
          }
        `,
        {
          variables: {
            input: {
              functionId: deliveryFn.id,
              title: "Rural Delivery",
              enabled: true,
            },
          },
        },
      );
      const createJson = await createResp.json();
      ownerId = createJson?.data?.deliveryCustomizationCreate?.deliveryCustomization?.id || null;
    }
  }

  if (!ownerId) {
    return json({ saved: false, error: "Missing customization" }, { status: 400 });
  }

  // Persist configuration on the customization owner metafield
  const config = {
    enabled,
    postcodes,
    ruralMethodsToKeep,
  };

  const setResp = await admin.graphql(
    `#graphql
      mutation SetConfig($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { message }
        }
      }
    `,
    {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: APP_NAMESPACE,
            key: "config",
            type: "json",
            value: JSON.stringify(config),
          },
        ],
      },
    },
  );
  const setJson = await setResp.json();
  const userErrors = setJson?.data?.metafieldsSet?.userErrors ?? [];
  const ok = userErrors.length === 0;

  return json({ saved: ok });
};

export default function Settings() {
  const { customizationId, enabled, postcodesText, ruralMethodsToKeepText } = useLoaderData();
  const fetcher = useFetcher();
  const app = useAppBridge();

  const [isEnabled, setIsEnabled] = useState(Boolean(enabled));
  const [postcodes, setPostcodes] = useState(postcodesText || "");
  const [methods, setMethods] = useState(ruralMethodsToKeepText || "");

  const isSaving = ["loading", "submitting"].includes(fetcher.state) && fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.saved) {
      app.toast.show("Saved");
    }
  }, [fetcher.data?.saved, app]);

  return (
    <Page title="Rural Delivery Settings">
      <Layout>
        <Layout.Section>
          <Card>
            <fetcher.Form method="post">
              <input type="hidden" name="customizationId" value={customizationId || ""} />
              <BlockStack gap="400">
                <Checkbox
                  label="Enabled"
                  checked={isEnabled}
                  onChange={(value) => setIsEnabled(Boolean(value))}
                />
                <input type="hidden" name="enabled" value={isEnabled ? "true" : "false"} />
                <FormLayout>
                  <TextField
                    label="Postcodes (comma-separated)"
                    name="postcodes"
                    value={postcodes}
                    onChange={setPostcodes}
                    multiline={4}
                    autoComplete="off"
                  />
                  <TextField
                    label="Rural methods to keep (handles or titles, comma-separated)"
                    name="ruralMethodsToKeep"
                    value={methods}
                    onChange={setMethods}
                    multiline={4}
                    autoComplete="off"
                  />
                </FormLayout>
                <Button submit primary loading={isSaving}>
                  Save
                </Button>
              </BlockStack>
            </fetcher.Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}


