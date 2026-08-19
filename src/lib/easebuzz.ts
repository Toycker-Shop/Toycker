import crypto, { timingSafeEqual } from "crypto"

export interface EasebuzzHashParams {
  key: string
  txnid: string
  amount: string
  productinfo: string
  firstname: string
  email: string
  udf1?: string
  udf2?: string
  udf3?: string
  udf4?: string
  udf5?: string
}

/**
 * Easebuzz Callback Payload Interface
 * Fields returned by Easebuzz in POST callback to surl/furl
 */
export interface EasebuzzCallbackPayload {
  status: string
  txnid: string
  amount: string
  productinfo: string
  firstname: string
  email: string
  key: string
  hash: string
  udf1?: string
  udf2?: string
  udf3?: string
  udf4?: string
  udf5?: string
  // Easebuzz-specific fields
  easepayid?: string
  phone?: string
  mode?: string
  net_amount_debit?: string
  payment_source?: string
  pg_type?: string
  cardCategory?: string
  bank_ref_num?: string
  bankcode?: string
  name_on_card?: string
  cardnum?: string
  card_type?: string
  addedon?: string
  merchant_logo?: string
  surl?: string
  furl?: string
  error?: string
  error_Message?: string
  [key: string]: string | undefined
}

/**
 * Generate Easebuzz Hash for payment request
 *
 * Easebuzz Hash Formula (same as PayU):
 * sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5|udf6|udf7|udf8|udf9|udf10|SALT)
 *
 * When udf2-udf10 are empty: key|...|udf1||||||||||SALT
 */
export const generateEasebuzzHash = (
  params: EasebuzzHashParams,
  salt: string
): string => {
  const hashString = [
    params.key,
    params.txnid,
    params.amount,
    params.productinfo,
    params.firstname,
    params.email,
    params.udf1 || "",
    params.udf2 || "",
    params.udf3 || "",
    params.udf4 || "",
    params.udf5 || "",
    "", // udf6
    "", // udf7
    "", // udf8
    "", // udf9
    "", // udf10
    salt,
  ].join("|")

  if (process.env.NODE_ENV === "development") {
    const debugString = hashString.replace(salt, "***SALT***")
    console.log("[EASEBUZZ] Hash string (masked):", debugString)
  }

  return crypto.createHash("sha512").update(hashString, "utf8").digest("hex")
}

/**
 * Verify Easebuzz Response Hash (Reverse Hash)
 *
 * Easebuzz Reverse Hash Formula (same as PayU):
 * sha512(SALT|status|udf10|udf9|udf8|udf7|udf6|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
 */
export const verifyEasebuzzHash = (
  payload: EasebuzzCallbackPayload,
  salt: string
): boolean => {
  const status = String(payload.status || "")
  const key = String(payload.key || "")
  const txnid = String(payload.txnid || "")
  const amount = String(payload.amount || "")
  const productinfo = String(payload.productinfo || "")
  const firstname = String(payload.firstname || "")
  const email = String(payload.email || "")

  const udf1 = String(payload.udf1 || "")
  const udf2 = String(payload.udf2 || "")
  const udf3 = String(payload.udf3 || "")
  const udf4 = String(payload.udf4 || "")
  const udf5 = String(payload.udf5 || "")

  const receivedHash = String(payload.hash || "").toLowerCase()

  // Reverse formula: salt|status|udf10|udf9|udf8|udf7|udf6|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
  const base = [
    salt,
    status,
    "", // udf10
    "", // udf9
    "", // udf8
    "", // udf7
    "", // udf6
    udf5,
    udf4,
    udf3,
    udf2,
    udf1,
    email,
    firstname,
    productinfo,
    amount,
    txnid,
    key,
  ].join("|")

  const computed = crypto
    .createHash("sha512")
    .update(base, "utf8")
    .digest("hex")
    .toLowerCase()

  if (process.env.NODE_ENV === "development") {
    const debugBase = base.replace(salt, "***SALT***")
    console.log("[EASEBUZZ] Verify hash string (masked):", debugBase)
    console.log("[EASEBUZZ] Computed hash:", computed.substring(0, 20) + "...")
    console.log(
      "[EASEBUZZ] Received hash:",
      receivedHash.substring(0, 20) + "..."
    )
  }

  const computedBuffer = Buffer.from(computed, "utf8")
  const receivedBuffer = Buffer.from(receivedHash, "utf8")
  const hashesMatch =
    computedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(computedBuffer, receivedBuffer)

  if (hashesMatch) {
    if (process.env.NODE_ENV === "development") {
      console.log("[EASEBUZZ] Hash verification: PASSED")
    }
    return true
  }

  console.log("[EASEBUZZ] Hash verification: FAILED")
  return false
}

export const verifyEasebuzzMerchantKey = (
  payload: EasebuzzCallbackPayload,
  merchantKey: string
): boolean => {
  const receivedKey = String(payload.key || "")
  const expectedKey = merchantKey.trim()
  const receivedBuffer = Buffer.from(receivedKey, "utf8")
  const expectedBuffer = Buffer.from(expectedKey, "utf8")

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  )
}

