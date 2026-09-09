/**
 * Validity rules for `ipaddress.ip_address`, used by `urlsplit` to police
 * bracketed hosts. Only a verdict is needed: `ip_address` collapses every
 * underlying parse failure into a single "does not appear to be" message.
 */

export type IpKind = "ipv4" | "ipv6";

const HEXTET_COUNT = 8;
const DECIMAL_OCTET = /^[0-9]+$/u;
const HEX_HEXTET = /^[0-9A-Fa-f]+$/u;

function isOctet(octet: string): boolean {
  if (!DECIMAL_OCTET.test(octet) || octet.length > 3) {
    return false;
  }
  // glibc `inet_pton` rejects leading zeros, so `010` is not 10 (bpo-36384).
  if (octet !== "0" && octet.startsWith("0")) {
    return false;
  }
  return Number(octet) <= 255;
}

export function isIpv4Address(value: string): boolean {
  const octets = value.split(".");
  return octets.length === 4 && octets.every(isOctet);
}

function isHextet(hextet: string): boolean {
  return HEX_HEXTET.test(hextet) && hextet.length <= 4;
}

function splitScopeId(value: string): { address: string; valid: boolean } {
  const percent = value.indexOf("%");
  if (percent === -1) {
    return { address: value, valid: true };
  }
  const scope = value.slice(percent + 1);
  return { address: value.slice(0, percent), valid: scope !== "" && !scope.includes("%") };
}

export function isIpv6Address(value: string): boolean {
  const { address, valid } = splitScopeId(value);
  if (!valid || address === "") {
    return false;
  }

  const parts = address.split(":");
  if (parts.length < 3) {
    return false;
  }

  const last = parts[parts.length - 1] ?? "";
  if (last.includes(".")) {
    if (!isIpv4Address(last)) {
      return false;
    }
    parts.pop();
    parts.push("0", "0");
  }
  if (parts.length > HEXTET_COUNT + 1) {
    return false;
  }

  let skipIndex: number | null = null;
  for (let index = 1; index < parts.length - 1; index += 1) {
    if (parts[index] === "") {
      if (skipIndex !== null) {
        return false;
      }
      skipIndex = index;
    }
  }

  let partsHi: number;
  let partsLo: number;
  if (skipIndex !== null) {
    partsHi = skipIndex;
    partsLo = parts.length - skipIndex - 1;
    if (parts[0] === "") {
      partsHi -= 1;
      if (partsHi !== 0) {
        return false;
      }
    }
    if (parts[parts.length - 1] === "") {
      partsLo -= 1;
      if (partsLo !== 0) {
        return false;
      }
    }
    if (HEXTET_COUNT - (partsHi + partsLo) < 1) {
      return false;
    }
  } else {
    if (parts.length !== HEXTET_COUNT) {
      return false;
    }
    if (parts[0] === "" || parts[parts.length - 1] === "") {
      return false;
    }
    partsHi = parts.length;
    partsLo = 0;
  }

  const leading = parts.slice(0, partsHi);
  const trailing = partsLo === 0 ? [] : parts.slice(parts.length - partsLo);
  return [...leading, ...trailing].every(isHextet);
}

export function ipAddressKind(value: string): IpKind | null {
  if (isIpv4Address(value)) {
    return "ipv4";
  }
  return isIpv6Address(value) ? "ipv6" : null;
}
