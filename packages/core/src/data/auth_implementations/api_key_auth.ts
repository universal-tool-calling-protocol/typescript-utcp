import { Auth } from "../auth";
import { Serializer } from "../../interfaces/serializer";
import { z } from "zod";

export interface ApiKeyAuth extends Auth {
  auth_type: "api_key";
  api_key: string;
  var_name: string; // header, query param, etc.
  location: "header" | "query" | "cookie";
}

export class ApiKeyAuthSerializer extends Serializer<ApiKeyAuth> {
  toDict(obj: ApiKeyAuth): { [key: string]: any } {
    return { ...obj };
  }

  validateDict(obj: { [key: string]: any }): ApiKeyAuth {
    return ApiKeyAuthSchema.parse(obj);
  }
}
  
const ApiKeyAuthSchema = z.object({
  auth_type: z.literal("api_key"),
  api_key: z.string(),
  var_name: z.string().default("X-Api-Key"),
  location: z.enum(["header", "query", "cookie"]).default("header"),
});