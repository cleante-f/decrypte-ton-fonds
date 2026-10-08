import { entretenir } from "../_partage/comptes.js";
Deno.serve((req: Request) => entretenir(req, Deno.env.toObject()));
