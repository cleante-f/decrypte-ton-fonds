import { creerPortail } from "../_partage/stripe.js";
Deno.serve((req: Request) => creerPortail(req, Deno.env.toObject()));
