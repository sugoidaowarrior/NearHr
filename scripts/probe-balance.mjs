import { rawViewFailover, defaultNearConfig, usdcContractId } from "../src/lib/near.ts";
const cfg = defaultNearConfig();
const c = usdcContractId(cfg.networkId);
const t = await rawViewFailover(c, "balance_of", { account_id: "eb03bc5b301ee1129f0eac8bcf9896375b5c1270cd4decb5b95d4a6348c62d2b" });
console.log("USDC balance_of:", t);
