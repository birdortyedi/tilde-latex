import { describe, expect, it } from 'vitest';
import { SyncTex } from './synctex';

// A real SyncTeX file from the engine (pdfLaTeX), for this project:
//   main.tex:            chapters/intro.tex:
//   1 \documentclass…    1 Intro paragraph here.
//   2 \begin{document}   2
//   3 First line of main.3 Second intro paragraph.
//   4
//   5 \input{chapters/intro}
//   6
//   7 Last words of main.
//   8 \end{document}
const SAMPLE = `SyncTeX Version:1
Input:1:/home/web_user/project_dir/./main.tex
Input:2:/texlive/texmf-dist/tex/latex/base/article.cls
Input:5:/home/web_user/project_dir/./chapters/intro.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
!366
{1
[1,8:4736286,46220574:26673152,41484288,0
[1,8:8799518,44254494:22609920,36044800,0
(1,4:8799518,8865054:22609920,455111,0
h1,3:8799518,8865054:983040,0,0
x1,3:11162458,8865054
g1,3:11380911,8865054
x1,3:14967195,8865054
k1,4:31409438,8865054:16442243
)
(5,2:8799518,9651486:22609920,455111,127431
h5,1:8799518,9651486:983040,0,0
x5,1:10383306,9651486
x5,1:15942954,9651486
k5,2:31409438,9651486:15466484
)
(1,6:8799518,10437918:22609920,455111,127431
h5,3:8799518,10437918:983040,0,0
x5,3:11785051,10437918
x5,3:16687519,10437918
k1,6:31409438,10437918:14430648
)
(1,8:8799518,11224350:22609920,455111,0
h1,7:8799518,11224350:983040,0,0
x1,7:11033206,11224350
x1,7:15480560,11224350
k1,8:31409438,11224350:15928878
)
]
]
!1575
}1
Postamble:
Count:53
`;

const bp = (sp: number) => sp / 65781.76;

describe('SyncTex', () => {
  const sync = SyncTex.parse(SAMPLE);

  it('finds the source line of a point in the PDF, also in an \\input file', () => {
    // On the second line of text, a little right of its start.
    expect(sync.toSource(1, bp(12_000_000), bp(9_500_000))).toEqual({ file: 'chapters/intro.tex', line: 1 });
    expect(sync.toSource(1, bp(12_000_000), bp(11_200_000))).toEqual({ file: 'main.tex', line: 7 });
  });

  it('uses the nearest line of text for a point between lines or in the margin', () => {
    expect(sync.toSource(1, bp(1_000_000), bp(8_800_000))).toEqual({ file: 'main.tex', line: 3 });
  });

  it('finds where a source line is in the PDF', () => {
    const [rect] = sync.toPdf('chapters/intro.tex', 3);
    expect(rect.page).toBe(1);
    expect(rect.x).toBeCloseTo(bp(8_799_518));
    expect(rect.y).toBeCloseTo(bp(10_437_918 - 455_111)); // top of the line: baseline minus height
    expect(rect.width).toBeCloseTo(bp(22_609_920));
  });

  it('uses the nearest line above for a line that made nothing visible', () => {
    expect(sync.toPdf('chapters/intro.tex', 2)).toEqual(sync.toPdf('chapters/intro.tex', 1));
    expect(sync.toPdf('main.tex', 1)).toEqual([]); // nothing above it made text
  });

  it('adds the offsets XeLaTeX writes', () => {
    const xe = SyncTex.parse(SAMPLE.replace('X Offset:0', 'X Offset:4736287').replace('Y Offset:0', 'Y Offset:4736287'));
    expect(xe.toPdf('main.tex', 7)[0].x).toBeCloseTo(bp(8_799_518 + 4_736_287));
  });
});
