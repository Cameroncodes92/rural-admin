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
  Modal,
  Text,
  InlineStack,
  Thumbnail,
  Collapsible,
  Scrollable,
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
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [showNorthList, setShowNorthList] = useState(false);
  const [showSouthList, setShowSouthList] = useState(false);
  const [postcodesExpanded, setPostcodesExpanded] = useState(false);
  const [shippingMethodsExpanded, setShippingMethodsExpanded] = useState(false);

  const isSaving = ["loading", "submitting"].includes(fetcher.state) && fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.saved) {
      app.toast.show("Saved");
    }
  }, [fetcher.data?.saved, app]);

  const PRESET_POSTCODES_NORTH = ["0792", "0793", "0794", "4771", "3979", "4884", "3078", "0486", "2675", "0496", "4894", "3493", "3494", "3495", "3496", "5791", "5792", "3581", "3582", "3583", "3584", "4971", "4972", "4973", "4975", "4976", "4977", "4978", "4970", "4979", "0371", "0372", "0373", "0374", "0376", "0377", "0370", "0379", "2577", "2578", "2579", "4994", "4996", "4993", "4995", "4398", "4399", "5771", "5772", "5773", "4775", "4777", "4779", "4891", "4893", "4071", "4072", "4073", "0991", "5794", "3281", "3282", "3283", "3284", "3285", "3286", "3287", "3288", "3289", "3290", "3293", "4171", "4172", "4174", "4175", "4179", "4180", "4178", "4294", "4295", "4671", "4672", "4673", "4674", "4675", "4678", "4679", "0874", "0875", "0781", "0782", "3579", "0181", "0182", "0184", "2571", "4781", "4782", "4783", "4784", "4785", "4786", "3771", "3772", "4386", "4387", "4388", "4389", "4390", "0478", "0479", "0474", "0472", "0473", "0481", "0482", "0483", "0484", "0573", "0185", "6972", "3177", "3178", "3170", "3181", "0871", "0873", "0281", "0282", "0283", "3889", "0294", "0295", "0293", "4774", "0491", "0492", "4188", "0891", "0892", "5571", "5574", "5575", "5572", "5570", "5573", "3978", "3492", "4797", "0494", "2576", "4078", "4787", "4788", "4789", "5881", "5882", "5883", "5884", "5885", "5886", "5887", "5888", "5889", "5890", "5871", "5872", "0593", "0594", "3471", "3472", "3473", "4075", "3995", "0583", "0587", "0588", "0589", "2474", "4376", "3371", "3372", "3373", "3374", "3375", "3079", "4181", "4182", "4183", "4184", "4186", "0772", "4371", "4372", "4373", "4374", "4381", "3793", "3794", "3597", "4974", "4198", "4691", "3881", "3882", "3883", "3784", "3980", "0475", "0476", "0192", "4278", "4279", "3997", "3885", "3886", "3197", "3198", "3199", "4681", "4682", "4684", "4685", "5581", "5582", "5583", "4276", "4277", "3972", "3973", "3974", "3975", "3976", "3977", "3989", "3990", "3671", "3672", "3673", "3674", "4981", "4982", "4983", "4984", "4985", "4986", "4987", "4988", "4989", "4471", "4472", "4473", "4474", "4475", "4476", "4477", "4478", "4479", "4470", "4481", "2580", "2582", "2583", "2584", "2585", "0571", "4597", "4598", "3971", "3970", "2471", "2472", "2473", "4990", "4991", "4992", "4291", "4292", "4293", "5381", "3880", "2676", "2677", "2678", "2679", "3481", "3482", "3483", "4694", "4696", "3295", "3296", "3297", "4189", "3081", "3083", "4780", "3077", "3072", "3073", "3074", "3076", "3096", "3097", "4081", "4082", "4083", "0591", "0592", "0272", "0994", "0992", "0993", "4391", "4392", "4393", "4394", "4395", "4396", "4397", "4791", "4792", "4793", "4794", "4795", "4796", "4286", "4287", "4288", "0381", "3991", "3992", "3993", "3994", "3996", "3791", "3792", "3377", "3378", "3379", "3384", "3385", "3171", "3172", "3173", "3174", "3175", "3176", "3179", "3180", "3391", "3392", "3393", "3879", "3872", "3873", "3874", "3875", "3876", "3877", "3878", "4091", "4092", "4093", "4094", "3781", "3782", "0391", "3981", "3982", "3983", "3985", "3986", "3987", "3988", "3894", "3895", "3182", "3183", "3186", "3187", "3188", "3189", "3578", "3577", "3574", "3575", "3576", "4087", "4086", "5894", "3484", "3485", "4079", "3491", "4077", "2696", "2697", "2693", "2694", "2695", "3381", "3382", "5371", "5372", "4377", "4375", "4379", "4378", "3474", "1971", "3681", "3682", "5391", "3196", "0881", "0882", "0883", "3998", "5373", "0193", "4271", "4272", "4273", "4274", "4275", "0582", "4281", "4282", "4283", "4284", "4285", "4191", "4197", "4193", "4195", "4196", "4382", "4383", "3380", "2681", "2682", "2683", "2684", "3475", "4571", "4572", "4573", "4574", "4575", "4576", "4577", "4578", "4581", "4582", "4584", "4585", "4586", "4587", "4588", "0981", "0982", "0983", "0984", "0985", "0986", "4591", "4592", "0972", "0973", "0974", "0975", "0977", "3191", "3192", "3193", "3194", "3691", "0171", "0172", "0173", "0174", "0175", "0176", "0178", "0179", "0170", "3591", "3592", "4997", "4998", "4999"];
  const PRESET_POSTCODES_SOUTH = ["7581", "7582", "7583", "9391", "9392", "9393", "7481", "7482", "7483", "7771", "7772", "7773", "7774", "7775", "7776", "7777", "7778", "9271", "9272", "9273", "9274", "9779", "7670", "7871", "7271", "7272", "7273", "7274", "7275", "7276", "9091", "7091", "7984", "7381", "7382", "7383", "7384", "7671", "7672", "7674", "7675", "7676", "7677", "7678", "9583", "9584", "7673", "7073", "9384", "9383", "7391", "7392", "7571", "7572", "9791", "7872", "9076", "9077", "7987", "7193", "7991", "7992", "9372", "9771", "9772", "9773", "9774", "9775", "9776", "9777", "7387", "7884", "7178", "7385", "7881", "7882", "7883", "9871", "9872", "9874", "9875", "9876", "9879", "9877", "7691", "7692", "7371", "7374", "7373", "9281", "9282", "7893", "7875", "9498", "9591", "9593", "7682", "7683", "7591", "9792", "9793", "9794", "8971", "5781", "5782", "5783", "5784", "7791", "9596", "9597", "9598", "9291", "9292", "9092", "7196", "7197", "7198", "7077", "7071", "7072", "9491", "9492", "9494", "9495", "9493", "9376", "9377", "9689", "9682", "9683", "9386", "9387", "9073", "9074", "9585", "9586", "7495", "9481", "9482", "9483", "7990", "7281", "7282", "7284", "7982", "7983", "9081", "9082", "9371", "7194", "7192", "7195", "7781", "7782", "7783", "7784", "9395", "9396", "9397", "9398", "7471", "7472", "7473", "7475", "7476", "7477", "7895", "7081", "9881", "9883", "7885", "7379", "9571", "9572", "7873", "7285", "7580", "7681", "7988", "7183", "7182", "9587", "9679", "9672", "7985", "7986", "7971", "7972", "7973", "7974", "7975", "9884", "9691", "7173", "7175", "7395", "9778", "7491", "9471", "9472", "7977", "7978", "7979", "7980", "9085", "7095", "7096", "9382", "7891", "7892", "7886", "9781", "9782", "9783", "9891", "9892", "9893"];
  const ALL_POSTCODES = [...PRESET_POSTCODES_NORTH, ...PRESET_POSTCODES_SOUTH];

  const copyToClipboard = async (text) => {
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      app.toast.show("Copied to clipboard");
    } catch (err) {
      app.toast.show("Unable to copy");
    }
  };

  return (
    <Page title="Rural Delivery Settings">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Configuration</Text>
              </InlineStack>
            </BlockStack>
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
                    multiline={postcodesExpanded ? 12 : 4}
                    autoSize={false}
                    maxHeight={postcodesExpanded ? 320 : 120}
                    connectedRight={
                      <Button size="slim" onClick={() => setPostcodesExpanded((v) => !v)}>
                        {postcodesExpanded ? "Collapse" : "Expand"}
                      </Button>
                    }
                    autoComplete="off"
                  />
                  <TextField
                    label="Rural methods to keep (handles or titles, comma-separated)"
                    name="ruralMethodsToKeep"
                    value={methods}
                    onChange={setMethods}
                    multiline={shippingMethodsExpanded ? 12 : 4}
                    autoSize={false}
                    maxHeight={shippingMethodsExpanded ? 320 : 120}
                    connectedRight={
                      <Button size="slim" onClick={() => setShippingMethodsExpanded((v) => !v)}>
                        {shippingMethodsExpanded ? "Collapse" : "Expand"}
                      </Button>
                    }
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
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Tutorial</Text>
              <Thumbnail
                source="https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
                alt="Rural Delivery tutorial thumbnail"
                size="large"
              />
              <Text as="p" variant="bodyMd">
                Learn how to configure rural postcodes and keep specific shipping methods in under 3 minutes.
              </Text>
              <InlineStack gap="200">
                <Button onClick={() => setIsTutorialOpen(true)}>Watch tutorial</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Quick rural postcodes</Text>
              <Text as="p" variant="bodyMd">Use the buttons below to automatically copy groups of postcodes. Then paste them above into the postcodes field.</Text>
              <InlineStack gap="200" wrap>
                <Button onClick={() => copyToClipboard(ALL_POSTCODES.join(", "))}>
                  Copy all NZ Rural Post Codes
                </Button>
                <Button onClick={() => copyToClipboard(PRESET_POSTCODES_NORTH.join(", "))}>
                  Copy all North Island Post Codes
                </Button>
                <Button onClick={() => copyToClipboard(PRESET_POSTCODES_SOUTH.join(", "))}>
                  Copy all South Island Post Codes
                </Button>
              </InlineStack>
              <Text as="p" variant="bodyMd">Expand to view the preset Post Codes for both North island and South island.</Text>
              <InlineStack gap="200">
                <Button onClick={() => setShowNorthList((v) => !v)}>
                  {showNorthList ? "Hide North Island Post Codes" : "Show North Island Post Codes"}
                </Button>
                <Button onClick={() => setShowSouthList((v) => !v)}>
                  {showSouthList ? "Hide South Island Post Codes" : "Show South Island Post Codes"}
                </Button>
              </InlineStack>
              <Collapsible open={showNorthList} id="north-postcodes">
                <Scrollable focusable style={{ maxHeight: 200 }}>
                  <Text as="p" variant="bodyMd" tone="subdued" style={{ fontFamily: "monospace", wordBreak: "break-word" }}>
                    {PRESET_POSTCODES_NORTH.join(", ")}
                  </Text>
                </Scrollable>
              </Collapsible>
              <Collapsible open={showSouthList} id="south-postcodes">
                <Scrollable focusable style={{ maxHeight: 200 }}>
                  <Text as="p" variant="bodyMd" tone="subdued" style={{ fontFamily: "monospace", wordBreak: "break-word" }}>
                    {PRESET_POSTCODES_SOUTH.join(", ")}
                  </Text>
                </Scrollable>
              </Collapsible>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      <Modal
        open={isTutorialOpen}
        onClose={() => setIsTutorialOpen(false)}
        title="How to configure Rural Delivery"
        large
      >
        <Modal.Section>
          <div style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
            <iframe
              src="https://www.youtube.com/embed/dQw4w9WgXcQ"
              title="Rural Delivery Tutorial"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: 0 }}
            />
          </div>
        </Modal.Section>
      </Modal>
    </Page>
  );
}


