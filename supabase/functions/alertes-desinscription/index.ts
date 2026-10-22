import { desinscrire } from "../_partage/alertes.js";
Deno.serve((req: Request) => desinscrire(req, Deno.env.toObject()));
