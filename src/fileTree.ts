export interface TreeNode {
  name: string;
  path: string; // full path inside the project, e.g. "chapters/intro.tex"
  children?: TreeNode[]; // only folders have children
}

// Builds a nested folder tree from flat paths like "chapters/intro.tex".
// Folders come first, then files, each sorted by name.
export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of paths) {
    const parts = path.split('/');
    let level = root;
    parts.forEach((name, i) => {
      const isFile = i === parts.length - 1;
      let node = level.find((n) => n.name === name && !n.children === isFile);
      if (!node) {
        node = { name, path: parts.slice(0, i + 1).join('/'), ...(isFile ? {} : { children: [] }) };
        level.push(node);
      }
      if (node.children) level = node.children;
    });
  }
  sortTree(root);
  return root;
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => Number(!a.children) - Number(!b.children) || a.name.localeCompare(b.name));
  for (const node of nodes) if (node.children) sortTree(node.children);
}

const TEXT_EXTENSIONS = ['tex', 'bib', 'sty', 'cls', 'bst', 'txt', 'md'];

// True for files the editor can show as text; everything else (images, PDFs) is previewed.
export function isTextFile(path: string): boolean {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_EXTENSIONS.includes(extension);
}
