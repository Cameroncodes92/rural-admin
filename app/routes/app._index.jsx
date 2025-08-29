import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const currentUrl = new URL(request.url);
  const search = currentUrl.search;
  return redirect(`/app/settings${search}`);
};

export const action = async ({ request }) => {
  const currentUrl = new URL(request.url);
  const search = currentUrl.search;
  return redirect(`/app/settings${search}`);
};
