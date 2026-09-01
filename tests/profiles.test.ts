import { describe, expect, it } from "vitest";
import { detectBankProfile } from "../src/lib/bankProfiles";

describe("representative international bank profile detection", () => {
  it.each([
    ["Jenius Bank BTPN $Cashtag transaction history", "jenius"],
    ["JPMorgan Chase Bank N.A. checking statement", "chase"],
    ["Barclays Bank PLC current account statement", "barclays"],
    ["Deutsche Bank Privatkonto Buchungstag", "deutsche-bank"],
    ["DBS Bank Ltd / POSB consolidated statement", "dbs"],
    ["HDFC Bank statement of account narration", "hdfc"],
    ["Royal Bank of Canada RBC Royal Bank statement", "rbc"],
    ["Commonwealth Bank of Australia NetBank", "commbank"],
  ])("detects %s", (text, expected) => expect(detectBankProfile(text).id).toBe(expected));
});
