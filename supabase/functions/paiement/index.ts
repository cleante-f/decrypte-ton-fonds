import { creerPaiement } from "../_partage/stripe.js";
Deno.serve((req: Request) => creerPaiement(req, Deno.env.toObject()));
