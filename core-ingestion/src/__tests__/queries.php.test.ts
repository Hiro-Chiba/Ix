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

  it('resolves nullable declared types', () => {
    // `?Service` parses as (optional_type (named_type (name))), not named_type.
    // Matching only the latter dropped every nullable dependency to a bare name.
    const result = parseFile(
      '/repo/Nullable.php',
      `<?php
final class Nullable
{
    private ?Service $service;

    public function __construct(private ?Repository $repository) {}

    public function run(?Logger $logger): void
    {
        $this->service->create();
        $this->repository->find();
        $logger->write();
    }
}
      `,
    );

    expect(result).not.toBeNull();
    expect(result!.relationships).toEqual(
      expect.arrayContaining([
        { srcName: 'Nullable.run', dstName: 'Service.create', predicate: 'CALLS' },
        { srcName: 'Nullable.run', dstName: 'Repository.find', predicate: 'CALLS' },
        { srcName: 'Nullable.run', dstName: 'Logger.write', predicate: 'CALLS' },
      ]),
    );
  });

  it('resolves typed parameters on plain functions, not just methods', () => {
    // function_definition is a separate node from method_declaration; rooting the
    // parameter query at the latter alone left top-level functions untyped.
    const result = parseFile(
      '/repo/Standalone.php',
      `<?php
function run(Service $service, ?Logger $logger): void
{
    $service->create();
    $logger->write();
}
      `,
    );

    expect(result).not.toBeNull();
    expect(result!.relationships).toEqual(
      expect.arrayContaining([
        { srcName: 'run', dstName: 'Service.create', predicate: 'CALLS' },
        { srcName: 'run', dstName: 'Logger.write', predicate: 'CALLS' },
      ]),
    );
  });

  it('leaves union-typed receivers as bare names', () => {
    // A union has no single receiver type to attribute the call to, so the bare
    // name is the honest answer rather than an arbitrary pick of one member.
    const result = parseFile(
      '/repo/Union.php',
      `<?php
final class Union
{
    public function run(Service|Repository $either): void
    {
        $either->create();
    }
}
      `,
    );

    expect(result).not.toBeNull();
    expect(result!.relationships).toContainEqual({
      srcName: 'Union.run',
      dstName: 'create',
      predicate: 'CALLS',
    });
  });
});
