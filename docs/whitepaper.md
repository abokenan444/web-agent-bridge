# Web Agent Bridge (WAB) DNS Discovery Protocol

**A Zero-Probe, Cryptographically Verified Infrastructure Layer for AI Agents**

---

> **© 2026 Web Agent Bridge (webagentbridge.com). All Rights Reserved.**
> This whitepaper is the intellectual property of the Web Agent Bridge project.
> Reproduction, redistribution, or modification — in whole or in part — is **prohibited**
> without prior written permission. The canonical, authoritative version is published at
> [https://webagentbridge.com/whitepaper](https://webagentbridge.com/whitepaper).
> Unauthorized copies are not authoritative and may be outdated, tampered with, or invalid.

**Version:** 1.3.0
**Status:** Published
**Date:** May 2026
**License:** All Rights Reserved — Read-Only Reference. See repository `LICENSE` for code-license terms (which are separate from this document).

---

## Abstract

As artificial intelligence agents transition from isolated chatbots to autonomous web navigators, the absence of a standardized, machine-readable discovery mechanism creates significant friction. Agents currently rely on heuristic DOM scraping, trial-and-error HTTP probing, and reverse-engineered APIs, leading to excessive server load, brittle integrations, and privacy risks. This paper introduces the **Web Agent Bridge (WAB) DNS Discovery Protocol**, a lightweight, infrastructure-first mechanism that allows AI agents to instantly discover a domain's AI capabilities and cryptographic trust attestations without prior HTTP interaction. Modeled after email authentication standards like SPF, DKIM, and DMARC, the WAB DNS Discovery Protocol utilizes DNS TXT records resolved over DNS over HTTPS (DoH) to advertise protocol support and endpoint locations. Furthermore, we detail the **WAB Cryptographic Trust Layer (v1.3)**, which employs Ed25519 signatures to ensure the integrity and authenticity of the discovery document, mitigating man-in-the-middle attacks and establishing a robust foundation for autonomous agent-web interactions.

## 1. Introduction

The proliferation of Large Language Models (LLMs) and autonomous AI agents has fundamentally altered how digital information is accessed and processed. Unlike human users who rely on visual interfaces and HTML/CSS rendering, AI agents require structured, deterministic access to web capabilities. However, the current web architecture lacks a native discovery layer for machine-to-machine interactions.

Currently, agents attempting to interact with a website face a "blind fetch" problem. They must either parse complex HTML structures, guess API endpoints, or probe for well-known files (e.g., `/.well-known/ai-plugin.json`), often resulting in HTTP 404 errors, increased latency, and unnecessary server overhead. Furthermore, the rise of "cookie-wall taxes" and aggressive bot mitigation strategies disproportionately penalize legitimate, beneficial AI traffic.

To address these challenges, we propose the **Web Agent Bridge (WAB) DNS Discovery Protocol**. By shifting the discovery phase to the Domain Name System (DNS) infrastructure, WAB enables **zero-probe discovery**. Agents can resolve a single DNS record to ascertain AI readiness, locate the capabilities document (`wab.json`), and verify the cryptographic signature of the provider, all before initiating an HTTP connection.

## 2. The WAB DNS Discovery Protocol (DDP)

The DNS Discovery Protocol (DDP) is an infrastructure-layer mechanism that allows domains to advertise their WAB endpoint and trust parameters. It is designed to be highly cacheable, universally supported, and easily verifiable.

### 2.1 Protocol Mechanics

The core of the DDP is a DNS TXT record placed at the `_wab` subdomain of the apex domain (e.g., `_wab.example.com`). This approach mirrors established email authentication protocols such as the Sender Policy Framework (SPF) [1] and DomainKeys Identified Mail (DKIM) [2].

When an AI agent intends to interact with a domain, it MUST first query the `_wab.{apex}` TXT record. If the DNS query returns `NXDOMAIN`, the agent concludes that the domain does not explicitly support the WAB protocol and falls back to traditional, heuristic methods. If the record exists, the agent parses the key-value pairs to locate the discovery document.

### 2.2 Record Format and Syntax

The WAB TXT record utilizes a semicolon-separated key-value format. The primary fields are defined as follows:

| Field      | Value Type | Requirement | Description                                                                          |
|------------|------------|-------------|--------------------------------------------------------------------------------------|
| `v`        | string     | REQUIRED    | Protocol version identifier. Current standard is `wab1`.                             |
| `endpoint` | URL        | REQUIRED    | The absolute HTTPS URL of the `wab.json` discovery document.                         |
| `pk`       | string     | OPTIONAL    | The public key for cryptographic verification, prefixed with the algorithm (e.g., `ed25519:<base64>`). |

**Example TXT Record:**

```
_wab.example.com. 3600 IN TXT "v=wab1; endpoint=https://example.com/.well-known/wab.json; pk=ed25519:PkQ7aq1E3jvMI2oL0rvYtTgOplWd+USw26Y/D4JzPxo="
```

### 2.3 DNS over HTTPS (DoH) Requirement

To prevent ISP-level interception, manipulation, and tracking of discovery queries, WAB-aware agents SHOULD resolve the `_wab` records using DNS over HTTPS (DoH) [3]. DoH encrypts the DNS query, shifting the trust boundary from the local network to a trusted DoH resolver (e.g., Cloudflare 1.1.1.1 or Google 8.8.8.8).

## 3. The Discovery Document (`wab.json`)

The discovery document, typically hosted at `/.well-known/wab.json`, is a structured JSON file that defines the domain's capabilities, permitted actions, and transport mechanisms.

### 3.1 Schema Overview (v1.3)

The `wab.json` schema is designed for extensibility and strict typing. Key components include:

- **`wab_version`** — Specifies the schema version (e.g., `"1.3.0"`).
- **`provider`** — Metadata regarding the domain owner, including name, category, and URL.
- **`capabilities`** — Defines the permitted actions (`commands`) and granular access rights (`permissions`).
- **`endpoints`** — Specifies the API endpoints for agent interaction (e.g., `/api/wab/discover`, `/api/wab/ping`).
- **`signature`** — The cryptographic signature block (detailed in Section 4).

### 3.2 Action Definitions

Actions (or commands) are explicitly defined within the `capabilities.commands` array. This eliminates the need for agents to infer functionality. Each command specifies its trigger mechanism (e.g., `api`, `navigate`), required parameters, and authentication prerequisites, providing a deterministic execution path.

## 4. Cryptographic Trust Layer (v1.3)

While DNS discovery provides routing, it does not inherently guarantee the integrity of the fetched `wab.json` document, especially if the HTTPS connection is compromised or misconfigured. To establish a robust chain of trust, WAB v1.3 introduces a **Cryptographic Trust Layer** based on Ed25519 signatures.

### 4.1 Ed25519 Signatures

Ed25519 [4] is a public-key signature system utilizing the Edwards-curve Digital Signature Algorithm (EdDSA). It was selected for WAB due to its high performance, small key size (32 bytes), and resilience against side-channel attacks.

### 4.2 Signature Generation and Verification

The trust layer operates through a deterministic canonicalization and signing process:

1. **Key Generation** — The domain owner generates an Ed25519 keypair. The private key is securely stored offline or within a secure enclave.
2. **DNS Publication** — The public key is published in the `_wab` DNS TXT record using the `pk=` parameter (e.g., `pk=ed25519:<base64_public_key>`).
3. **Canonicalization** — Before signing, the `wab.json` document undergoes RFC 8785-style JSON canonicalization [5]. This process sorts object keys lexicographically, removes insignificant whitespace, and excludes the top-level `signature` field to ensure a consistent byte representation.
4. **Signing** — The canonicalized JSON string is signed using the Ed25519 private key.
5. **Manifest Embedding** — The resulting signature is embedded back into the `wab.json` document under the `signature` object.

**Signature Block Example:**

```json
"signature": {
  "algorithm": "ed25519",
  "value": "base64_encoded_signature_string...",
  "key_id": "pYu7X5PF/HoE2yDx",
  "signed_at": "2026-05-02T10:00:00Z"
}
```

### 4.3 Agent Verification Flow

Upon fetching the `wab.json` document, a WAB-compliant agent performs the following verification steps:

1. Extracts the `pk` value from the previously resolved `_wab` DNS TXT record.
2. Extracts the `signature` object from the `wab.json` document.
3. Verifies that `signature.algorithm` is `ed25519`.
4. Canonicalizes the `wab.json` document (excluding the `signature` field).
5. Verifies the canonicalized string against the `signature.value` using the extracted public key.

If the verification succeeds, the agent possesses cryptographic proof that the capabilities document was authorized by the entity controlling the domain's DNS records, effectively neutralizing unauthorized modifications.

## 5. Implementation and Adoption

The WAB protocol is designed for frictionless adoption by both site owners and agent developers.

### 5.1 Zero-Code Infrastructure Onboarding

Site owners can enable WAB discovery without deploying new code. By simply adding the `_wab` TXT record and hosting a static `wab.json` file, a domain becomes "Agent-Ready." This infrastructure-first approach lowers the barrier to entry compared to complex API integrations.

### 5.2 The Proof Lab and Live Verification

To facilitate adoption and ensure compliance, the Web Agent Bridge provides a **"Proof Lab."** This tool performs a live, end-to-end verification of the integration:

1. **DNS Resolution** — Verifies the presence and syntax of the `_wab` TXT record via DoH.
2. **Document Fetch** — Retrieves and parses the `wab.json` file.
3. **Agent Execution** — Simulates an agent flow by calling the defined endpoints (e.g., `/api/wab/discover`, `/api/wab/ping`) to confirm execution readiness (`execution_ok=true`).

## 6. Conclusion

The Web Agent Bridge (WAB) DNS Discovery Protocol and its Cryptographic Trust Layer provide a critical missing piece in the architecture of the autonomous web. By leveraging proven DNS infrastructure and Ed25519 cryptography, WAB enables zero-probe, secure, and deterministic discovery of AI capabilities. This protocol reduces server overhead, enhances privacy through DoH, and establishes a verifiable chain of trust, paving the way for scalable and secure machine-to-machine interactions on the internet.

## References

[1] S. Kitterman, *"Sender Policy Framework (SPF) for Authorizing Use of Domains in Email, Version 1,"* RFC 7208, April 2014.
[2] D. Crocker, T. Hansen, and M. Kucherawy, *"DomainKeys Identified Mail (DKIM) Signatures,"* RFC 6376, September 2011.
[3] P. Hoffman and P. McManus, *"DNS Queries over HTTPS (DoH),"* RFC 8484, October 2018.
[4] S. Josefsson and I. Liusvaara, *"Edwards-Curve Digital Signature Algorithm (EdDSA),"* RFC 8032, January 2017.
[5] A. Rundgren, B. Jordan, and S. Erdtman, *"JSON Canonicalization Scheme (JCS),"* RFC 8785, June 2020.

---

*This document is read-only reference material. The canonical version lives at*
*[https://webagentbridge.com/whitepaper](https://webagentbridge.com/whitepaper).*
*All rights reserved © 2026 Web Agent Bridge.*
