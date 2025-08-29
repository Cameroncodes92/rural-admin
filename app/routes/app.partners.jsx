import { Page, Layout, Card, BlockStack, Text, List, Link } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

export default function PartnersPage() {
  return (
    <Page>
      <TitleBar title="Partners" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Built by:</Text>
              <List>
                <List.Item>
                  <Link removeUnderline>Cameron Fulton</Link>
                </List.Item>
                <List.Item>
                  <Link url="#" removeUnderline>Plus 5 Designs</Link>
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Recommended partner apps</Text>
              <List>
                <List.Item>
                  <Link url="https://polaris.shopify.com/components" target="_blank" removeUnderline>
                    Polaris components
                  </Link>
                </List.Item>
                <List.Item>
                  <Link url="https://shopify.dev/docs/apps" target="_blank" removeUnderline>
                    Shopify app docs
                  </Link>
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}


