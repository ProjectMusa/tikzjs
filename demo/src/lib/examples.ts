export interface Example {
  name: string
  source: string
}

export const examples: Example[] = [
  {
    name: 'Straight Lines',
    source: `\\begin{tikzpicture}
\\draw (0,0) -- (2,0) -- (2,2) -- (0,2) -- cycle;
\\end{tikzpicture}`,
  },
  {
    name: 'Arrows',
    source: `\\begin{tikzpicture}
\\draw[->] (0,0) -- (2,0);
\\draw[<-] (0,1) -- (2,1);
\\draw[<->] (0,2) -- (2,2);
\\end{tikzpicture}`,
  },
  {
    name: 'Grid & Rectangle',
    source: `\\begin{tikzpicture}
\\draw[gray, very thin] (0,0) grid (3,3);
\\draw[thick] (0,0) rectangle (3,3);
\\end{tikzpicture}`,
  },
  {
    name: 'Filled Shapes',
    source: `\\begin{tikzpicture}
  \\fill[blue!20] (0,0) rectangle (1,1);
  \\fill[red!40] (1.5,0) rectangle (2.5,1);
  \\draw[thick] (0,0) rectangle (1,1);
  \\draw[thick,dashed] (1.5,0) rectangle (2.5,1);
  \\node at (0.5,0.5) {A};
  \\node at (2,0.5) {B};
\\end{tikzpicture}`,
  },
  {
    name: 'Node Shapes',
    source: `\\begin{tikzpicture}
  \\node[draw,circle,minimum size=1cm] at (0,0) {A};
  \\node[draw,rectangle,minimum width=1.5cm,minimum height=0.8cm] at (2,0) {B};
  \\node[draw,circle,fill=blue!20,minimum size=0.8cm] at (4,0) {C};
  \\draw[->] (0.5,0) -- (1.25,0);
  \\draw[->] (2.75,0) -- (3.6,0);
\\end{tikzpicture}`,
  },
  {
    name: 'Foreach Loop',
    source: `\\begin{tikzpicture}
\\foreach \\x in {0,1,2,3} {
  \\draw (\\x,0) -- (\\x,2);
}
\\foreach \\y in {0,1,2} {
  \\draw (0,\\y) -- (3,\\y);
}
\\end{tikzpicture}`,
  },
  {
    name: 'Bezier Curves',
    source: `\\begin{tikzpicture}
  \\draw[thick,->] (0,0) .. controls (1,1) and (2,1) .. (3,0);
  \\draw[thick,->,blue] (0,-0.5) .. controls (1,0.5) .. (3,-0.5);
\\end{tikzpicture}`,
  },
  {
    name: 'Graph with Styles',
    source: `\\begin{tikzpicture}
  \\tikzstyle{every node}=[draw, circle, minimum size=6mm, inner sep=1pt]
  \\node (a) at (0,0) {1};
  \\node (b) at (2,0) {2};
  \\node (c) at (1,1.5) {3};
  \\draw[->] (a) -- (b);
  \\draw[->] (b) -- (c);
  \\draw[->] (c) -- (a);
\\end{tikzpicture}`,
  },
]
