/**
 * Unit tests for SyncEnvelopeGeneratorService
 * Requirements: 7.1-7.9, 9.3
 *
 * Core logic tests are in sync-envelope-generator.test.js (plain Node.js)
 * due to ts-jest compilation overhead with AWS SDK imports.
 * This file validates the service can be imported and instantiated.
 */
jest.mock('@aws-sdk/client-s3');

import { SyncEnvelopeGeneratorService } from '../../src/instant-rag/sync-envelope-generator.service';

describe('SyncEnvelopeGeneratorService', () => {
  it('should build correct S3 path', () => {
    const svc = new SyncEnvelopeGeneratorService({ $queryRaw: jest.fn() } as any);
    expect(svc.buildS3Path('tenant-abc', 'deal-xyz', 'session-1')).toBe('kb-ready/tenant-abc/deal-xyz/session-1/');
  });
});
