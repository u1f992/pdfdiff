# pdfdiff

Visualize and quantify differences between two PDF files.

## Usage

```
$ npx @u1f992/pdfdiff --help
USAGE:
    pdfdiff <A> <B> <OUT> [OPTIONS]

OPTIONS:
    --dpi <DPI>                    default: 72
    --alpha                        default: true
    --mask <PATH>                  default: undefined
    --align <resize | top-left | top-center | top-right
             | middle-left | middle-center | middle-right
             | bottom-left | bottom-center | bottom-right>    default: resize
    --addition-color <#HEX>        default: #4cae4fff
    --deletion-color <#HEX>        default: #ff5724ff
    --modification-color <#HEX>    default: #ffc105ff
    --workers <N>                  default: min(CPU cores, 4)
    --out-type <directory | diff-pdf | a-b-diff-pdf>    default: directory
             directory       <OUT>/<page>/{a,b,diff}.png
             diff-pdf        <OUT> is a PDF of the diff images
             a-b-diff-pdf    <OUT> is a PDF of A, B and the diff side by side
                             (a PDF is written only when a page is output)
    --exit-code                    exit 1 if differences are found
    --diff-only                    output only pages with differences
    -v, --version
    -h, --help

EXIT STATUS:
    0    success (with --exit-code: no differences found)
    1    differences found (only with --exit-code)
    2    error
```
