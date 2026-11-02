import { describe, expect, it } from 'vitest';
import { keyWithDoi, parseDoi, tidyBibtex } from './doi';

// What doi.org really sent (November 2026).
const CROSSREF = ' @inproceedings{Akiba_2019, series={KDD ’19}, title={Optuna: A Next-generation Hyperparameter Optimization Framework}, url={http://dx.doi.org/10.1145/3292500.3330701}, DOI={10.1145/3292500.3330701}, booktitle={Proceedings of the 25th ACM SIGKDD International Conference on Knowledge Discovery &amp; Data Mining}, publisher={ACM}, author={Akiba, Takuya and Sano, Shotaro and Yanase, Toshihiko and Ohta, Takeru and Koyama, Masanori}, year={2019}, month=July, pages={2623–2631}, collection={KDD ’19} }\n';
const DATACITE = `@misc{https://doi.org/10.48550/arxiv.1706.03762,
  doi = {10.48550/ARXIV.1706.03762},
  url = {https://arxiv.org/abs/1706.03762},
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  keywords = {Computation and Language (cs.CL), Machine Learning (cs.LG)},
  title = {Attention Is All You Need},
  publisher = {arXiv},
  year = {2017},
  copyright = {arXiv.org perpetual, non-exclusive license}
}
`;

describe('parseDoi', () => {
  it('reads DOIs as people paste them', () => {
    expect(parseDoi('10.1145/3292500.3330701')).toBe('10.1145/3292500.3330701');
    expect(parseDoi(' https://doi.org/10.1145/3292500.3330701 ')).toBe('10.1145/3292500.3330701');
    expect(parseDoi('doi:10.1109/CVPR.2016.90')).toBe('10.1109/CVPR.2016.90');
  });

  it('turns arXiv links and numbers into their DOI', () => {
    expect(parseDoi('https://arxiv.org/abs/1706.03762v7')).toBe('10.48550/arXiv.1706.03762');
    expect(parseDoi('arxiv.org/pdf/2103.00020.pdf')).toBe('10.48550/arXiv.2103.00020');
    expect(parseDoi('1706.03762')).toBe('10.48550/arXiv.1706.03762');
  });

  it('refuses anything else', () => {
    expect(parseDoi('Attention is all you need')).toBeNull();
    expect(parseDoi('')).toBeNull();
  });
});

describe('tidyBibtex', () => {
  it('tidies a Crossref entry: short key, one field per line, \\& and -- and a month macro', () => {
    const result = tidyBibtex(CROSSREF, new Set());
    expect(result?.key).toBe('akiba2019');
    expect(result?.text).toContain('@inproceedings{akiba2019,\n  series = {KDD ’19},\n');
    expect(result?.text).toContain('Knowledge Discovery \\& Data Mining');
    expect(result?.text).toContain('  pages = {2623--2631},');
    expect(result?.text).toContain('  month = jul,');
    expect(result?.text.endsWith('}\n')).toBe(true);
  });

  it('tidies a DataCite (arXiv) entry and leaves out its extras', () => {
    const result = tidyBibtex(DATACITE, new Set());
    expect(result?.key).toBe('vaswani2017');
    expect(result?.text).not.toContain('keywords');
    expect(result?.text).not.toContain('copyright');
    expect(result?.text).toContain('  title = {Attention Is All You Need},');
  });

  it('picks another key when the first is taken', () => {
    expect(tidyBibtex(DATACITE, new Set(['vaswani2017']))?.key).toBe('vaswani2017b');
  });
});

describe('keyWithDoi', () => {
  it('finds an entry that already has the DOI, whatever its case or form', () => {
    const bib = '@book{knuth1984,\n title={The TeXbook}}\n@misc{vaswani2017,\n  doi = {https://doi.org/10.48550/ARXIV.1706.03762},\n}\n';
    expect(keyWithDoi(bib, '10.48550/arXiv.1706.03762')).toBe('vaswani2017');
    expect(keyWithDoi(bib, '10.1145/3292500.3330701')).toBeNull();
  });
});
