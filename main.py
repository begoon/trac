from dataclasses import dataclass, field
from typing import Callable

BuiltIn = Callable[["TRAC"], str]


@dataclass
class Frame:
    begin: int  # index in neutral where the function body begins
    mode: str  # "active" for #(, "neutral" for ##(
    argument_slices: list[tuple[int, int]] = field(default_factory=list)
    current_argument_start: int = 0


# A segment marker placed by ss(), numbered 1,2,3,...
@dataclass
class Marker:
    n: int


Part = str | Marker  # a chunk of literal text or a numbered marker


class TRAC:
    def __init__(self, builtins: dict[str, BuiltIn] | None = None):
        self.builtins: dict[str, BuiltIn] = {}

        # persistent across eval_program() calls
        self.forms: dict[str, list[Part]] = {}

        # runtime working state (reset per record)
        self.active: list[str] = []
        self.neutral: list[str] = []
        self.scan: int = 0
        self.frames: list[Frame] = []
        self.args: list[str] = []

        # characters to skip at step 3 (record/whitespace)
        self._skip_chars = {"\t", "\n", "\r", "'"}

        # register core built-ins that many programs assume exist
        self._register_core_builtins()
        if builtins:
            self.builtins.update(builtins)  # allow user overrides

    def execute(self, s: str) -> str:
        print(s)

        self._reset_processor_with(s)
        while True:
            # Step 2: end-of-active?
            if self.scan >= len(self.active):
                break

            ch = self.active[self.scan]

            # Step 3: control chars / apostrophe = record end
            if ch in self._skip_chars:
                self._delete_active_char()
                continue

            # Step 4: protective parentheses
            if ch == "(":
                if not self._consume_balanced_parentheses_into_neutral():
                    self._clear_processor()
                    break
                continue

            # Step 5: comma -> argument boundary
            if ch == ",":
                self._delete_active_char()
                self._mark_argument_boundary()
                continue

            # Step 6/7: #( or ##(
            if ch == "#":
                if self._peek("("):  # "#("
                    self._delete_active_char()
                    self._delete_active_char()
                    self._begin_function("active")
                    continue
                if self._peek("#", "("):  # "##("
                    self._delete_active_char()
                    self._delete_active_char()
                    self._delete_active_char()
                    self._begin_function("neutral")
                    continue
                # Step 8: a lone '#'
                self._move_active_char_to_neutral()
                continue

            # Step 9: end of function
            if ch == ")":
                self._delete_active_char()
                self._end_function_and_evaluate()
                continue

            # Step 10: ordinary char
            self._move_active_char_to_neutral()

        return "".join(self.neutral)

    def _reset_processor_with(self, program: str):
        self.neutral.clear()
        self.active[:] = list(program)
        self.scan = 0
        self.frames.clear()
        self.args = []

    def _clear_processor(self):
        self.neutral.clear()
        self.active.clear()
        self.scan = 0
        self.frames.clear()
        self.args = []

    def _delete_active_char(self):
        if self.scan < len(self.active):
            del self.active[self.scan]

    def _move_active_char_to_neutral(self):
        self.neutral.append(self.active[self.scan])
        self._delete_active_char()  # scan stays

    def _peek(self, *expect: str) -> bool:
        i = self.scan + 1
        if i + len(expect) - 1 >= len(self.active):
            return False
        return all(self.active[i + off] == c for off, c in enumerate(expect))

    def _consume_balanced_parentheses_into_neutral(self) -> bool:
        self._delete_active_char()  # delete '('
        depth = 1
        i = self.scan
        while i < len(self.active):
            ch = self.active[i]
            if ch == "(":
                depth += 1
                self.neutral.append(ch)
                del self.active[i]
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    del self.active[i]  # delete matching ')'
                    return True
                self.neutral.append(ch)
                del self.active[i]
            else:
                self.neutral.append(ch)
                del self.active[i]
        return False

    def _begin_function(self, mode: str):
        begin = len(self.neutral)
        frame = Frame(begin=begin, mode=mode, current_argument_start=begin)
        self.frames.append(frame)

    def _mark_argument_boundary(self):
        if not self.frames:
            return
        frame = self.frames[-1]
        current_end = len(self.neutral)
        current_slice = (frame.current_argument_start, current_end)
        frame.argument_slices.append(current_slice)
        frame.current_argument_start = len(self.neutral)

    def _end_function_and_evaluate(self):
        if not self.frames:
            self._clear_processor()
            return

        frame = self.frames.pop()
        final_end = len(self.neutral)
        frame.argument_slices.append((frame.current_argument_start, final_end))

        # extract string arguments from neutral
        body_start, body_end = frame.begin, final_end
        args: list[str] = [
            "".join(self.neutral[a:b]) for (a, b) in frame.argument_slices
        ]

        # remove the function body from neutral
        del self.neutral[body_start:body_end]

        # evaluate
        name = args[0] if args else ""
        self.args = args[1:]
        value = ""
        if name in self.builtins:
            try:
                value = self.builtins[name](self)
            except Exception:
                value = ""
        else:
            value = ""

        # deliver
        if frame.mode == "neutral":
            self.neutral.extend(list(value))
        else:
            self.active = list(value) + self.active[self.scan :]
            self.scan = 0

        self.args = []  # clear after call

    def _register_core_builtins(self):
        def ds(t: TRAC) -> str:
            """
            #(ds,N,B) -> define/replace form N with body B.
            Pointer semantics are not needed for this interpreter. We store
            the body as a list[Part] with a single literal chunk initially.
            """
            name = t._arg(0)
            body = t._arg(1)
            if not name:
                return ""
            t.forms[name] = [body]  # literal body, no markers yet
            return ""

        def ss(t: TRAC) -> str:
            """
            #(ss,N,P1,P2,...) -> create ordinal segment markers in form N.
            Each non-null Pi is searched left-to-right and each occurrence
            (that does not cross an existing marker) is replaced by Marker(i).
            """
            name = t._arg(0)
            if name not in t.forms:
                return ""
            parts = t.forms[name]  # list[Part]

            def replace_pattern_in_parts(
                parts: list[Part],
                pattern: str,
                num: int,
            ) -> list[Part]:
                if pattern == "":
                    return parts

                out: list[Part] = []
                for part in parts:
                    if isinstance(part, Marker):
                        out.append(part)
                        continue
                    s = part
                    i = 0
                    L = len(pattern)
                    while True:
                        j = s.find(pattern, i)
                        if j == -1:
                            out.append(s[i:])
                            break
                        out.append(s[i:j])  # prefix
                        out.append(Marker(num))  # marker
                        i = j + L  # continue after match

                # merge adjacent strings for cleanliness
                merged: list[Part] = []
                for item in out:
                    if (
                        merged
                        and isinstance(merged[-1], str)
                        and isinstance(item, str)
                    ):
                        merged[-1] += item
                    else:
                        merged.append(item)
                return merged

            # Process arguments P1,P2,... in order; null arguments are ignored,
            # but their *numbers* are preserved (i stays as 1-based position).
            for i, pattern in enumerate(
                t.args[1:], start=2
            ):  # t.args = [N, P1, P2,...] ? No: see below.
                pass  # (not used; kept to explain indexing)

            # NOTE: t.args currently contains only parameters after the
            # function name, so for ss: t.args = [N, P1, P2, ...]
            # Markers are numbered by the ordinal position of Pi (1-based).
            for i, pattern in enumerate(t.args[1:], start=1):
                if pattern != "":
                    parts = replace_pattern_in_parts(parts, pattern, i)

            t.forms[name] = parts
            return ""

        def cl(t: TRAC) -> str:
            """
            #(cl,N,A1,A2,...)  -> return the body of form N with markers
            filled: all #1 -> A1, #2 -> A2, etc. (missing -> "", excess ignored)
            """
            name = t._arg(0)
            if name not in t.forms:
                return ""
            parts = t.forms[name]

            # Build replacement map 1->A1, 2->A2, ...
            replacement = {
                i + 1: (t.args[i + 1] if i + 1 < len(t.args) else "")
                for i in range(len(t.args))
            }  # t.args[0] is N

            chunks: list[str] = []
            for part in parts:
                if isinstance(part, Marker):
                    chunks.append(replacement.get(part.n, ""))
                else:
                    chunks.append(part)
            return "".join(chunks)

        def eq(t: TRAC) -> str:
            # #(eq,A,B,T,F) -> T if A==B else F (missing args -> "")
            A = t._arg(0)
            B = t._arg(1)
            T = t._arg(2)
            F = t._arg(3)
            return T if A == B else F

        def ml(t: TRAC) -> str:
            a = int(t._arg(0) or "0")
            b = int(t._arg(1) or "0")
            return str(a * b)

        def ad(t: TRAC) -> str:
            a = int(t._arg(0) or "0")
            b = int(t._arg(1) or "0")
            return str(a + b)

        def su(t: TRAC) -> str:
            a = int(t._arg(0) or "0")
            b = int(t._arg(1) or "0")
            return str(a - b)

        def ln(t: TRAC) -> str:
            """
            #(ln,S) -> return all form names, separated by S.
            """
            sep = t._arg(0)  # argument S
            names = list(t.forms.keys())
            return sep.join(names)

        def dd(t: TRAC) -> str:
            """
            #(dd,N1,N2,...) -> delete the forms N1, N2, ...
            Returns null string.
            """
            for i in range(len(t.args)):
                name = t._arg(i)
                if name in t.forms:
                    del t.forms[name]
            return ""

        def ps(t: TRAC) -> str:
            """
            #(ps,X) -> print the string X to output (stdout here).
            Returns null string.
            """
            x = t._arg(0)
            if x is not None:
                print(x, end="")
            return ""

        self.builtins.update(
            {
                "ds": ds,
                "ss": ss,
                "cl": cl,
                "eq": eq,
                "ml": ml,
                "su": su,
                "ad": ad,
                "ln": ln,
                "dd": dd,
                "ps": ps,
            }
        )

    def _arg(self, i: int) -> str:
        return self.args[i] if i < len(self.args) else ""


if __name__ == "__main__":
    trac = TRAC()

    fact = "#(ds,Factorial,(#(eq,X,1,1,(#(ml,X,#(cl,Factorial,#(su,X,1)))))))'"
    v = trac.execute(fact)
    assert v == "", f"{v=}"

    fact_ss = "#(ss,Factorial,X)'"
    v = trac.execute(fact_ss)
    assert v == "", f"{v=}"

    fact_5 = "#(cl,Factorial,5)'"
    v = trac.execute(fact_5)
    print(v)
    assert v == "120", f"{v=}"

    fact_50 = "#(cl,Factorial,50)'"
    v = trac.execute(fact_50)
    print(v)
    assert (
        v == "30414093201713378043612608166064768844377641568960512000000000000"
    ), f"{v=}"

    trivia = "((3+4))*9 = #(ml,#(ad,3,4),9)'"
    v = trac.execute(trivia)
    print(v)
    assert v == "(3+4)*9 = 63", f"{v=}"

    fact_ = """
    #(cl,Factorial,5
    #(ds,Factorial,(
    #(eq,X,1,
    1,
    (#(ml,X,#(cl,Factorial,#(su,X,1)))))))
    #(ss,Factorial,X))'
    """
    v = trac.execute(fact_.strip()).strip()
    print(v)
    assert v == "120", f"{v=}"

    v = trac.execute("#(ps,#(ln,(,)))'")
    print(v)
    assert v == "", f"{v=}"

    v = trac.execute("#(ds,AA,Cat)'")
    print(v)
    assert v == "", f"{v=}"

    v = trac.execute("#(ds,BB,(#(cl,AA)))'")
    print(v)
    assert v == "", f"{v=}"

    v = trac.execute("#(ps,(#(cl,bb)))'")
    print(v)
    assert v == "", f"{v=}"

    v = trac.execute("#(ps,##(cl,BB))'")
    print(v)
    assert v == "", f"{v=}"

    v = trac.execute("#(ps,#(cl,BB))'")
    print(v)
    assert v == "", f"{v=}"
