import assert from 'node:assert/strict';
import { type Review } from '../../schema/authoring';
import { digest } from './generation-files';

// SHA-256 of UTF-8 JSON: recursively sorted object keys, original array order,
// original JSON values, no whitespace. Hash raw parsed JSON, before schema transforms.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  const encoded = JSON.stringify(value);
  assert.ok(encoded !== undefined, 'Fingerprint exige valor JSON');
  return encoded;
}
export const candidateFingerprint = (raw: unknown) => digest(canonical(raw));

// Immutable evidence derived from all four sets at the audited commit. This is
// NOT an extensible approval registry; new IDs always require an explicit approval.
export const historicalApprovalCommit = 'be05aa18155751bc675d78beb617bd17c6ff612f';
export const historicalApprovals = {
  'farmacologia-anti-hipertensivos-teste-2026': {
    candidate: '6d272de870c315745e832fde3bf5608a9c0722b92435cc8b025915ae2fb22572',
    candidateCanonical: '77be2364084475a3087a8ce938d0c816a2cfb6f6f36564a0b2603a15bb8037c9',
    review: '934d69f2e210329ce152f042bee780a49e29a4916aec659e39e6586f944c5e19',
    reviewCanonical: '10859d123cf5a2ad3bea89e2b14d18170b45f5d51b951a503cde72254859cead',
    generation: '4fa71dfa1ce4da58574cf9f4c45ff318c00fedd4e62354cf6fd76e4d4eee8103',
    production: '6d272de870c315745e832fde3bf5608a9c0722b92435cc8b025915ae2fb22572',
  },
  'farmacologia-parassimpatoliticos': {
    candidate: '684a9e33ab82a6829a38de85800e9a66c6499c2b8dfb88d4f736159659aee7e9',
    candidateCanonical: 'a01eb212bf5d96fb6e374858cba0163439400f30f0afd4384b07cd86e58f6dca',
    review: '85f2a64465a46fa83973adc655cd4c771681a8314e1b1f652ba5459c4e1d4ec8',
    reviewCanonical: 'e3cf5f87645cee7481b7e90d8f46b47f572399ab6caae206b163d7e7ec866742',
    generation: '1b605d3b1533590c76a725f10d5ea0cec2765b0afac8dda9f4c47727d9130476',
    production: '684a9e33ab82a6829a38de85800e9a66c6499c2b8dfb88d4f736159659aee7e9',
  },
  'parasitologia-ancilostomiase-2026': {
    candidate: 'c4f8f607bd0f12d3d720e2612a3dd87427c27589c60496c216c05f3a83cc4710',
    candidateCanonical: 'fc4d4550718f9f02dc5bffc23993d8a77954f785738e453442b9a81c2954e838',
    review: '5c921e36d07ccc6a9d061cc7ab2cb275faa2c7d1c824cc18160927fbea89a63d',
    reviewCanonical: '48eeed482a182248752fbf7bd26c1aacdd21b725fc5581674476d5b11854de7c',
    generation: '9ff0b76fffc5d451b94e5aa3a781d7ba9a192f06bb59b2f97daedd282b71dec5',
    production: 'c4f8f607bd0f12d3d720e2612a3dd87427c27589c60496c216c05f3a83cc4710',
  },
  'parasitologia-larva-migrans-cutanea-2026': {
    candidate: 'bde8da58e46ce5f501cef5ebef7344a683e841c28ba10215a386349adefb1d98',
    candidateCanonical: '9bfbcd71b3089da1b73f32ea09b0bac56738af1eb27405c40ded7c9e8a4d4e21',
    review: '338e41ad6b48d142aa776d0d2f0a5702a5e3e639c2f6db83d47ab30eb3355d41',
    reviewCanonical: 'ca76c3dddee1c63e63aa39b167e92125ab6351dae2d89188479a5c4062641995',
    generation: 'd93796484e8b83fbfecb0ef19d573ee582161db9208c50ea706486fbea8d3aa5',
    production: 'bde8da58e46ce5f501cef5ebef7344a683e841c28ba10215a386349adefb1d98',
  },
} as const;
export type HistoricalId = keyof typeof historicalApprovals;
export function historicalEvidence(id: string) {
  return Object.hasOwn(historicalApprovals, id)
    ? historicalApprovals[id as HistoricalId]
    : undefined;
}
export function assertApprovalBinding(raw: unknown, manifest: unknown, review: Review) {
  if (review.status !== 'approved') return;
  const fingerprint = candidateFingerprint(raw);
  if (review.approval) {
    assert.equal(
      review.approval.candidateSha256,
      fingerprint,
      'Vínculo de aprovação divergente: candidate mudou após aprovação; invalide o review, revise e obtenha nova aprovação humana',
    );
    return;
  }
  const historical = historicalEvidence(review.examId);
  assert.ok(
    historical &&
      historical.candidateCanonical === fingerprint &&
      historical.reviewCanonical === candidateFingerprint(manifest),
    'Review approved sem vínculo de aprovação válido: novo ID exige aprovação humana via author:flow approve',
  );
}
