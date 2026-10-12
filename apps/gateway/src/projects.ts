import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Project { id: string; name: string; canonicalPath: string; createdAt: string }

export class ProjectAllowlist {
  private readonly roots: string[];
  private readonly projects = new Map<string, Project>();

  constructor(roots: string[]) { this.roots = roots; }

  async initialize(): Promise<void> {
    if (this.roots.some((root) => !path.isAbsolute(root))) throw new Error('Configured project roots must be absolute paths');
    const canonicalRoots = await Promise.all(this.roots.map(async (root) => {
      const canonical = await realpath(root);
      if (!(await stat(canonical)).isDirectory()) throw new Error('Configured project roots must be directories');
      return canonical;
    }));
    this.roots.splice(0, this.roots.length, ...canonicalRoots);
  }

  async register(inputPath: string): Promise<Project> {
    if (!path.isAbsolute(inputPath) || inputPath.includes('\0')) throw new Error('Invalid project path');
    const canonicalPath = await realpath(inputPath);
    if (!(await stat(canonicalPath)).isDirectory()) throw new Error('Project path must be a directory');
    if (!this.roots.some((root) => canonicalPath === root || canonicalPath.startsWith(`${root}${path.sep}`))) {
      throw new Error('Project path is outside configured roots');
    }
    const existing = [...this.projects.values()].find((item) => item.canonicalPath === canonicalPath);
    if (existing) return existing;
    const project: Project = { id: randomUUID(), name: path.basename(canonicalPath), canonicalPath, createdAt: new Date().toISOString() };
    this.projects.set(project.id, project);
    return project;
  }

  list(): Project[] { return [...this.projects.values()]; }
  get(id: string): Project | undefined { return this.projects.get(id); }
}
