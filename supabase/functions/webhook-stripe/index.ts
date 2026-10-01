import { recevoirWebhook } from "../_partage/stripe.js";
Deno.serve((req: Request) => recevoirWebhook(req, Deno.env.toObject()));
