import { z } from "zod";

export const materialNameSchema = z.string().trim().min(1, "Material name is required");
