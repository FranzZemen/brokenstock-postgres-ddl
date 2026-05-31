import 'mocha';
import * as chai from 'chai';
import {existsSync, readdirSync} from 'node:fs';
import {migrationsDir} from '@franzzemen/brokenstock-postgres-ddl';

const expect = chai.expect;

describe('@franzzemen/brokenstock-postgres-ddl', () => {
  describe('migrationsDir', () => {
    it('is a non-empty string', () => {
      expect(migrationsDir).to.be.a('string');
      expect(migrationsDir.length).to.be.greaterThan(0);
    });

    it('resolves to an existing directory', () => {
      expect(existsSync(migrationsDir)).to.equal(true);
    });

    it('contains the expected migration files', () => {
      const files = readdirSync(migrationsDir)
        .filter(f => !f.endsWith('.map') && !f.endsWith('.d.ts'));
      expect(files).to.include('2026-05-30T140000Z_smoke_events.js');
      expect(files).to.include('2026-05-30T140030Z_worker_jobs.js');
    });
  });
});
