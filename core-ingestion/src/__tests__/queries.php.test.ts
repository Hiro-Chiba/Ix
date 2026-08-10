import { describe, expect, it } from 'vitest';

import { parseFile } from '../index.js';

describe('PHP queries', () => {
  it('normalizes namespace imports to the imported class name', () => {
    const result = parseFile(
      '/repo/UseCase.php',
      `<?php
namespace App;

use Vendor\\Contracts\\DomainService;
      `,
    );

    expect(result).not.toBeNull();
    expect(result!.relationships).toContainEqual({
      srcName: 'UseCase.php',
      dstName: 'DomainService',
      predicate: 'IMPORTS',
      importRaw: 'Vendor\\Contracts\\DomainService',
    });
  });

  it('resolves calls through typed properties and method parameters', () => {
    const result = parseFile(
      '/repo/UseCase.php',
      `<?php
interface DomainService
{
    public function create(): void;
}

interface Repository
{
    public function create(): void;
}

final class UseCase
{
    private AuditLogger $auditLogger;

    public function __construct(
        private DomainService $domainService,
        private Repository $repository,
    ) {}

    public function create(Logger $logger): void
    {
        $this->domainService->create();
        $this->repository?->create();
        $this->auditLogger->write();
        $logger->write();
        $this->finish();
    }

    private function finish(): void {}
}
      `,
    );

    expect(result).not.toBeNull();
    expect(result!.relationships).toEqual(
      expect.arrayContaining([
        { srcName: 'UseCase.create', dstName: 'DomainService.create', predicate: 'CALLS' },
        { srcName: 'UseCase.create', dstName: 'Repository.create', predicate: 'CALLS' },
        { srcName: 'UseCase.create', dstName: 'AuditLogger.write', predicate: 'CALLS' },
        { srcName: 'UseCase.create', dstName: 'Logger.write', predicate: 'CALLS' },
        { srcName: 'UseCase.create', dstName: 'UseCase.finish', predicate: 'CALLS' },
      ]),
    );
    expect(result!.relationships).not.toContainEqual({
      srcName: 'UseCase.create',
      dstName: 'create',
      predicate: 'CALLS',
    });
    expect(result!.relationships).not.toContainEqual({
      srcName: 'UseCase.create',
      dstName: 'UseCase.create',
      predicate: 'CALLS',
    });
  });

  it('preserves bare-name fallback when the receiver type is unknown', () => {
    const result = parseFile(
      '/repo/Runner.php',
      `<?php
function run($service): void
{
    $service->create();
}
      `,
    );

    expect(result).not.toBeNull();
    expect(result!.relationships).toContainEqual({
      srcName: 'run',
      dstName: 'create',
      predicate: 'CALLS',
    });
  });
});
