from __future__ import annotations

import os
from pathlib import Path

from PIL import Image
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_ROW_HEIGHT_RULE, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output"
ASSET_DIR = ROOT / ".tmp" / "user_manual_assets"
OUTPUT = OUTPUT_DIR / "MetaWork_사용자테스트_매뉴얼.docx"
GUI = ROOT / "GUI"

BLACK = "000000"
NAVY = "1F3A5F"
BLUE = "2563EB"
TEAL = "0F9F95"
PALE_BLUE = "EEF4FB"
PALE_GRAY = "F6F7F9"
MID_GRAY = "6B7280"
LIGHT_BORDER = "D9D9D9"
WHITE = "FFFFFF"
RED = "C73A32"
FONT = "Malgun Gothic"


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=110, start=120, bottom=110, end=120) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for m, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{m}"))
        if node is None:
            node = OxmlElement(f"w:{m}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table, color=LIGHT_BORDER, size="6") -> None:
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), color)


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def prevent_row_split(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    tr_pr.append(cant_split)


def set_run_font(run, size=11, bold=False, color=BLACK, italic=False) -> None:
    run.font.name = FONT
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = RGBColor.from_string(color)
    r_pr = run._element.get_or_add_rPr()
    r_fonts = r_pr.rFonts
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.insert(0, r_fonts)
    for key in ("ascii", "hAnsi", "eastAsia", "cs"):
        r_fonts.set(qn(f"w:{key}"), FONT)


def set_paragraph_font(paragraph, size=11, bold=False, color=BLACK) -> None:
    for run in paragraph.runs:
        set_run_font(run, size=size, bold=bold, color=color)


def add_page_number(paragraph) -> None:
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run("페이지 ")
    set_run_font(run, size=9, color=MID_GRAY)
    fld_char1 = OxmlElement("w:fldChar")
    fld_char1.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = "PAGE"
    fld_char2 = OxmlElement("w:fldChar")
    fld_char2.set(qn("w:fldCharType"), "end")
    run._r.append(fld_char1)
    run._r.append(instr_text)
    run._r.append(fld_char2)


def set_document_defaults(doc: Document) -> None:
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.68)
    section.bottom_margin = Inches(0.65)
    section.left_margin = Inches(0.72)
    section.right_margin = Inches(0.72)

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = FONT
    normal.font.size = Pt(10.8)
    normal.font.color.rgb = RGBColor.from_string(BLACK)
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing = 1.18

    title = styles["Title"]
    title.font.name = FONT
    title.font.size = Pt(28)
    title.font.bold = True
    title.font.color.rgb = RGBColor.from_string(BLACK)
    title._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    title.paragraph_format.space_after = Pt(8)

    for name, size, before, after in (
        ("Heading 1", 20, 12, 8),
        ("Heading 2", 15, 9, 5),
        ("Heading 3", 12, 7, 4),
    ):
        style = styles[name]
        style.font.name = FONT
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor.from_string(BLACK)
        style._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True
        if name == "Heading 1":
            style.paragraph_format.page_break_before = True

    if "Caption Korean" not in styles:
        caption = styles.add_style("Caption Korean", WD_STYLE_TYPE.PARAGRAPH)
        caption.font.name = FONT
        caption.font.size = Pt(9)
        caption.font.color.rgb = RGBColor.from_string(MID_GRAY)
        caption._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
        caption.paragraph_format.space_before = Pt(3)
        caption.paragraph_format.space_after = Pt(7)

    for sec in doc.sections:
        footer = sec.footer
        footer.is_linked_to_previous = False
        p = footer.paragraphs[0]
        add_page_number(p)


def p(doc, text="", size=10.8, bold=False, color=BLACK, align=None, before=0, after=5, keep=False):
    paragraph = doc.add_paragraph()
    if align is not None:
        paragraph.alignment = align
    paragraph.paragraph_format.space_before = Pt(before)
    paragraph.paragraph_format.space_after = Pt(after)
    paragraph.paragraph_format.keep_with_next = keep
    run = paragraph.add_run(text)
    set_run_font(run, size=size, bold=bold, color=color)
    return paragraph


def add_bullets(doc, items, level=0, size=10.6):
    for item in items:
        paragraph = doc.add_paragraph(style="List Bullet" if level == 0 else "List Bullet 2")
        paragraph.paragraph_format.space_after = Pt(3)
        paragraph.paragraph_format.left_indent = Inches(0.25 + 0.18 * level)
        paragraph.paragraph_format.first_line_indent = Inches(-0.12)
        run = paragraph.add_run(item)
        set_run_font(run, size=size)


def add_steps(doc, steps):
    for idx, text in enumerate(steps, 1):
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.left_indent = Inches(0.28)
        paragraph.paragraph_format.first_line_indent = Inches(-0.28)
        paragraph.paragraph_format.space_after = Pt(4)
        nr = paragraph.add_run(f"{idx}  ")
        set_run_font(nr, size=10.8, bold=True, color=BLUE)
        tr = paragraph.add_run(text)
        set_run_font(tr, size=10.8)


def add_table(doc, headers, rows, widths=None, font_size=9.6, header_fill=NAVY, repeat=True):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table)
    hdr = table.rows[0]
    if repeat:
        set_repeat_table_header(hdr)
    for i, header in enumerate(headers):
        cell = hdr.cells[i]
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_shading(cell, header_fill)
        set_cell_margins(cell, top=120, bottom=120)
        if widths:
            cell.width = Inches(widths[i])
        paragraph = cell.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.space_after = Pt(0)
        run = paragraph.add_run(str(header))
        set_run_font(run, size=font_size, bold=True, color=WHITE)
    for row_idx, values in enumerate(rows):
        row = table.add_row()
        prevent_row_split(row)
        if row_idx % 2 == 1:
            for cell in row.cells:
                set_cell_shading(cell, PALE_BLUE)
        for i, value in enumerate(values):
            cell = row.cells[i]
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_margins(cell)
            if widths:
                cell.width = Inches(widths[i])
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(0)
            paragraph.paragraph_format.line_spacing = 1.1
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER if i == 0 else WD_ALIGN_PARAGRAPH.LEFT
            run = paragraph.add_run(str(value))
            set_run_font(run, size=font_size)
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return table


def add_checklist(doc, items):
    for item in items:
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.left_indent = Inches(0.25)
        paragraph.paragraph_format.first_line_indent = Inches(-0.25)
        paragraph.paragraph_format.space_after = Pt(4)
        box = paragraph.add_run("☐  ")
        set_run_font(box, size=11.5, bold=True, color=TEAL)
        run = paragraph.add_run(item)
        set_run_font(run, size=10.5)


def add_label_value(doc, label, value):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.space_after = Pt(4)
    r1 = paragraph.add_run(label + "  ")
    set_run_font(r1, size=10.5, bold=True, color=NAVY)
    r2 = paragraph.add_run(value)
    set_run_font(r2, size=10.5)
    return paragraph


def crop_image(filename: str, stem: str, crop_top=0.0, crop_bottom=1.0) -> Path:
    src = GUI / filename
    dest = ASSET_DIR / f"{stem}.png"
    with Image.open(src) as im:
        w, h = im.size
        top = max(0, int(h * crop_top))
        bottom = min(h, int(h * crop_bottom))
        cropped = im.crop((0, top, w, bottom))
        cropped.save(dest, optimize=True)
    return dest


def add_screenshot(doc, path: Path, caption: str, max_height=4.45):
    with Image.open(path) as im:
        width_px, height_px = im.size
    max_width = 7.0
    ratio = width_px / height_px
    width = min(max_width, max_height * ratio)
    height = width / ratio
    if height > max_height:
        height = max_height
        width = height * ratio
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_before = Pt(3)
    paragraph.paragraph_format.space_after = Pt(2)
    run = paragraph.add_run()
    run.add_picture(str(path), width=Inches(width), height=Inches(height))
    cap = doc.add_paragraph(style="Caption Korean")
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.add_run(caption)


def add_test_case(doc, test_id, title, role, goal, data, steps, expected, screenshot=None, caption=None):
    doc.add_heading(f"{test_id} {title}", level=1)
    add_label_value(doc, "수행 역할", role)
    add_label_value(doc, "확인 목표", goal)
    if data:
        add_label_value(doc, "연습 데이터", data)
    doc.add_heading("수행 절차", level=2)
    add_steps(doc, steps)
    doc.add_heading("완료 기준", level=2)
    add_checklist(doc, expected)
    if screenshot and caption:
        add_screenshot(doc, screenshot, caption)


def add_score_line(doc, label):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.space_after = Pt(7)
    r1 = paragraph.add_run(label)
    set_run_font(r1, size=10.5, bold=True)
    r2 = paragraph.add_run("    1  ☐    2  ☐    3  ☐    4  ☐    5  ☐")
    set_run_font(r2, size=10.5, color=NAVY)


def page_break(doc):
    # Heading 1 carries the section page break. Keeping this helper as a no-op
    # avoids blank pages when a preceding screenshot already fills its page.
    return None


def build() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)

    images = {
        "login": crop_image("0 로그인 (오류 상태)@1x.png", "login"),
        "password": crop_image("0 첫 로그인 비밀번호 변경@1x.png", "password"),
        "dashboard": crop_image("1 대시보드@1x.png", "dashboard", 0.0, 0.67),
        "report_top": crop_image("2 주간업무보고 작성@1x.png", "report_top", 0.0, 0.39),
        "report_body": crop_image("2 주간업무보고 작성@1x.png", "report_body", 0.32, 0.69),
        "meeting": crop_image("3 회의록 등록@1x.png", "meeting", 0.0, 0.78),
        "action": crop_image("4 액션아이템 등록@1x.png", "action", 0.0, 0.82),
        "tracking": crop_image("5 액션트래킹 (부서 진행 등록)@1x.png", "tracking", 0.0, 0.76),
        "bot": crop_image("6 AI봇@1x.png", "bot", 0.0, 0.78),
        "master": crop_image("7 마스터 관리 (구분·세부내용)@1x.png", "master", 0.0, 0.66),
        "employee": crop_image("8 사원 · 권한@1x.png", "employee", 0.0, 0.60),
    }

    doc = Document()
    set_document_defaults(doc)

    # Cover
    logo_p = doc.add_paragraph()
    logo_p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    logo_p.paragraph_format.space_after = Pt(28)
    logo_p.add_run().add_picture(str(GUI / "logo.png"), width=Inches(2.15))
    title = doc.add_paragraph(style="Title")
    title.add_run("MetaWork 사용자 테스트 매뉴얼")
    subtitle = p(doc, "주간업무보고와 회의 액션 관리 시범 운영", size=15, bold=True, color=NAVY, after=18)
    p(doc, "평가자는 이 문서의 연습 데이터를 입력하면서 업무 생성부터 보고 제출, 회의 지시사항 배정, 진행 등록, AI 조회까지 전체 흐름을 확인합니다.", size=11.5, after=20)
    add_table(
        doc,
        ["문서 정보", "내용"],
        [
            ["대상", "시범 운영 참여자와 사용자 테스트 진행자"],
            ["버전", "1.0"],
            ["기준일", "2026년 10월 20일"],
            ["예상 시간", "개인 테스트 45분에서 60분"],
        ],
        widths=[1.5, 5.2],
        font_size=10.2,
    )
    p(doc, "연습 데이터 원칙", size=11, bold=True, color=NAVY, before=12, after=5)
    p(doc, "문서에 표시된 입력값은 사용자 평가용 예시입니다. 실제 테스트 환경에 입력할 때는 모든 제목 앞에 [TEST]를 붙이고, 평가 종료 후 테스트 진행자에게 삭제 대상을 알려 주세요.", size=10.5, color=MID_GRAY)

    page_break(doc)

    # Orientation
    doc.add_heading("테스트 시작 전에 확인할 사항", level=1)
    p(doc, "이번 평가는 기능이 존재하는지만 확인하는 작업이 아닙니다. 사용자가 업무 흐름을 이해하고, 필요한 정보를 찾고, 입력 결과를 스스로 확인할 수 있는지를 평가합니다.")
    doc.add_heading("접속과 준비", level=2)
    add_checklist(doc, [
        "Chrome 또는 Edge 최신 버전을 사용한다.",
        "테스트 진행자가 배정한 계정으로 로그인한다.",
        "팀원, 팀장, 회의 서기, 관리자 중 본인에게 배정된 역할을 확인한다.",
        "테스트 중 실제 업무 데이터는 수정하지 않고 [TEST]가 붙은 데이터만 사용한다.",
        "오류가 발생하면 화면, 입력값, 발생 시각을 결함 기록표에 남긴다.",
    ])
    doc.add_heading("평가 방법", level=2)
    add_table(
        doc,
        ["평가", "판정 기준"],
        [
            ["성공", "도움 없이 절차를 완료하고 기대 결과를 확인함"],
            ["부분 성공", "한 번의 안내 또는 재시도 후 완료함"],
            ["실패", "기능을 찾지 못했거나 저장 결과가 기대와 다름"],
            ["해당 없음", "배정된 권한으로 수행할 수 없는 항목"],
        ],
        widths=[1.45, 5.25],
        font_size=10,
    )
    doc.add_heading("테스트에서 사용할 이야기", level=2)
    p(doc, "메타시스템즈는 신제품 M Dent 출시를 준비하고 있습니다. 사업개발팀은 출시 일정을 보고하고, 전사 주간회의에서 인증 자료와 시생산 일정의 보완 지시가 나옵니다. 회의 서기는 지시사항을 액션으로 배정하고, 담당 부서는 진행 내용을 등록합니다. 다음 주에는 잠시 보류했던 인증 업무를 다시 시작하며, 임원은 대시보드와 AI봇에서 전체 진행 상황을 확인합니다.")

    page_break(doc)

    # Roles and data
    doc.add_heading("연습 역할과 데이터", level=1)
    doc.add_heading("역할별 수행 범위", level=2)
    add_table(
        doc,
        ["역할", "연습 사용자", "주요 수행 항목"],
        [
            ["팀원", "이서윤", "본인 주간업무 작성, 소속 부서 액션 진행 등록"],
            ["팀장", "박준호", "팀 보고서 검토와 제출, 팀원 업무 확인"],
            ["회의 서기", "김하늘", "회의록 등록, 액션아이템 등록과 배정"],
            ["임원", "최민석", "전사 현황 조회, 결정 필요 업무 확인"],
            ["관리자", "김하늘", "마스터와 사원 권한 확인"],
        ],
        widths=[1.1, 1.25, 4.35],
        font_size=9.8,
    )
    p(doc, "위 이름은 설명을 위한 가상 사용자입니다. 실제 테스트에서는 배정받은 계정의 이름이 화면에 표시됩니다.", size=9.5, color=MID_GRAY)
    doc.add_heading("공통 연습 데이터", level=2)
    add_table(
        doc,
        ["항목", "입력값"],
        [
            ["프로젝트", "[TEST] M Dent 신제품 출시 준비"],
            ["주간보고 타이틀", "[TEST] 유럽 인증 자료 보완"],
            ["회의", "2026년 10월 20일 전사 주간회의"],
            ["액션 1", "RA팀 기술문서 누락 항목 보완, 기한 2026년 10월 23일"],
            ["액션 2", "생산팀 시생산 일정 재산정, 기한 2026년 10월 24일"],
            ["액션 3", "사업개발 덴탈 대리점 안내문 검토, 기한 2026년 10월 23일"],
        ],
        widths=[1.7, 5.0],
        font_size=9.8,
    )
    doc.add_heading("테스트 순서", level=2)
    add_table(
        doc,
        ["순서", "테스트", "권장 역할", "예상 시간"],
        [
            ["1", "로그인과 비밀번호 변경", "전체", "5분"],
            ["2", "대시보드 현황 확인", "전체", "5분"],
            ["3", "주간업무보고 작성과 보류 재개", "팀원, 팀장", "15분"],
            ["4", "회의록과 액션아이템 등록", "회의 서기", "12분"],
            ["5", "액션 진행 등록", "담당 부서", "7분"],
            ["6", "AI봇 질의", "전체", "5분"],
            ["7", "마스터와 사원 권한 확인", "관리자", "6분"],
        ],
        widths=[0.65, 3.05, 1.65, 1.35],
        font_size=9.5,
    )

    page_break(doc)

    # Login
    add_test_case(
        doc,
        "UT 01",
        "로그인과 첫 비밀번호 변경",
        "전체 사용자",
        "계정 상태에 따라 로그인과 최초 비밀번호 변경 흐름이 올바르게 동작하는지 확인합니다.",
        "테스트 진행자가 배정한 아이디와 임시 비밀번호",
        [
            "로그인 화면에서 아이디와 비밀번호를 입력하고 로그인합니다.",
            "처음 로그인하는 계정이면 현재 비밀번호와 새 비밀번호를 입력합니다.",
            "새 비밀번호 확인까지 입력한 뒤 변경 버튼을 누릅니다.",
            "변경 완료 후 대시보드로 이동하는지 확인합니다.",
            "일반 계정은 로그아웃한 뒤 새 비밀번호로 다시 로그인합니다.",
        ],
        [
            "잘못된 로그인 정보에는 오류 메시지가 표시된다.",
            "최초 로그인 계정은 비밀번호를 변경하기 전 다른 메뉴로 이동할 수 없다.",
            "비밀번호 변경 후 대시보드가 열린다.",
            "로그아웃 후 변경한 비밀번호로 다시 로그인할 수 있다.",
        ],
        images["login"],
        "화면 예시 1 로그인 화면과 오류 메시지",
    )
    add_screenshot(doc, images["password"], "화면 예시 2 첫 로그인 비밀번호 변경")

    page_break(doc)

    # Dashboard
    add_test_case(
        doc,
        "UT 02",
        "대시보드에서 우선 업무 찾기",
        "전체 사용자",
        "요약 카드와 목록을 통해 이번 주 보고 제출 상태와 주의가 필요한 액션을 찾을 수 있는지 확인합니다.",
        "조회 범위 전체, 현재 주차",
        [
            "좌측 메뉴에서 대시보드를 선택합니다.",
            "조회 주차와 팀 범위를 확인합니다.",
            "요약 카드의 미완료 액션, 장기 미완료, 결정 대기 건수를 확인합니다.",
            "주의 필요 액션에서 한 항목을 선택해 액션트래킹으로 이동합니다.",
            "뒤로 이동한 뒤 주간업무보고 제출 현황을 확인합니다.",
        ],
        [
            "선택한 주차와 팀 기준으로 카드와 목록의 수치가 함께 바뀐다.",
            "주의 필요 액션을 누르면 해당 항목이 열린 액션트래킹 화면으로 이동한다.",
            "제출, 작성중, 미작성 팀을 구분할 수 있다.",
        ],
        images["dashboard"],
        "화면 예시 3 대시보드의 요약 카드와 진행 현황",
    )

    page_break(doc)

    # Weekly report
    add_test_case(
        doc,
        "UT 03",
        "주간업무 타이틀 추가와 보고 작성",
        "팀원 또는 팀장",
        "새 업무 타이틀을 만들고 금주 실적과 차주 계획을 저장할 수 있는지 확인합니다.",
        "타이틀 [TEST] 유럽 인증 자료 보완, 담당 이서윤, 구분 KPI, 세부내용 인증 대응",
        [
            "주간업무보고 작성 메뉴에서 현재 주차와 소속 팀을 확인합니다.",
            "타이틀 추가를 누르고 연습 데이터의 타이틀, 담당자, 구분, 세부내용을 입력합니다.",
            "금주 실적에 기술문서 18종 중 15종 검토 완료를 입력합니다.",
            "결과에서 계속을 선택합니다.",
            "차주 계획에 누락 3종 보완 후 RA팀 최종 검토 요청을 입력하고 저장합니다.",
            "내 담당 필터와 검색창으로 방금 만든 타이틀을 다시 찾습니다.",
        ],
        [
            "새 타이틀이 선택한 구분과 세부내용 아래에 표시된다.",
            "저장 후 새로고침해도 금주 실적, 결과, 차주 계획이 유지된다.",
            "내 담당 필터와 제목 검색 결과가 일치한다.",
            "팀원은 본인 담당 타이틀만 수정할 수 있고 팀장은 팀 타이틀을 수정할 수 있다.",
        ],
        images["report_top"],
        "화면 예시 4 주간업무보고 작성 상단과 필터",
    )
    add_screenshot(doc, images["report_body"], "화면 예시 5 타이틀별 금주 실적과 차주 계획 입력")

    page_break(doc)

    # Hold/resume
    add_test_case(
        doc,
        "UT 04",
        "보류 업무 숨기기와 다시 시작하기",
        "팀원 또는 팀장",
        "보류한 타이틀의 노출 여부를 사용자가 직접 제어하고 나중에 같은 타이틀로 재개할 수 있는지 확인합니다.",
        "UT 03에서 만든 [TEST] 유럽 인증 자료 보완",
        [
            "UT 03의 타이틀에서 결과를 보류로 변경합니다.",
            "다음 주부터 숨기기를 선택하지 않은 상태로 저장하고 다음 주차에서 타이틀이 계속 보이는지 확인합니다.",
            "다시 보류를 선택하고 다음 주부터 숨기기를 체크한 뒤 저장합니다.",
            "다음 주차로 이동해 타이틀이 일반 목록에서 보이지 않는지 확인합니다.",
            "숨긴 보류 업무 목록을 열고 해당 타이틀의 금주 업무로 재개를 선택합니다.",
            "같은 타이틀과 이전 주차 이력이 유지된 채 현재 주차에 다시 나타나는지 확인합니다.",
        ],
        [
            "보류만 선택하면 다음 주에도 타이틀이 이어진다.",
            "보류와 숨기기를 함께 선택하면 다음 주 일반 목록에서 제외된다.",
            "숨긴 보류 업무 목록에서 타이틀과 마지막 보고 이력을 확인할 수 있다.",
            "재개 후 새 타이틀이 중복 생성되지 않고 기존 이력이 유지된다.",
        ],
    )
    doc.add_page_break()
    doc.add_heading("결과값 선택 기준", level=2)
    add_table(
        doc,
        ["결과", "사용 상황", "다음 주 처리"],
        [
            ["완료", "업무 목표를 끝냄", "다음 주 보고 대상에서 제외"],
            ["계속", "다음 주에도 같은 업무를 진행함", "차주 계획을 다음 주 금주 실적으로 이월"],
            ["중단", "업무를 종료하고 더 이상 진행하지 않음", "다음 주 보고 대상에서 제외"],
            ["보류", "재개 가능성이 있으나 지금은 진행하지 않음", "숨기기 선택 여부에 따라 계속 노출 또는 숨김"],
        ],
        widths=[0.9, 2.9, 2.9],
        font_size=9.5,
    )

    page_break(doc)

    # Meeting
    add_test_case(
        doc,
        "UT 05",
        "회의록 임시저장과 등록",
        "회의 서기",
        "회의 정보를 임시저장하고 본문을 작성한 뒤 전사 공유 상태로 등록할 수 있는지 확인합니다.",
        "2026년 10월 20일 주간회의, 주재 최민석, 제목 [TEST] M Dent 출시 점검",
        [
            "회의록 등록 메뉴에서 새 회의록을 선택합니다.",
            "회의구분, 회의일자, 주재, 참석자와 제목을 입력합니다.",
            "본문에 인증 자료 보완, 시생산 일정 재산정, 대리점 안내문 검토를 입력합니다.",
            "임시저장을 누르고 목록으로 이동한 뒤 다시 열어 입력값이 유지되는지 확인합니다.",
            "필수 항목을 확인하고 등록 및 공유를 누릅니다.",
            "등록된 회의록의 표시번호와 상태를 확인합니다.",
        ],
        [
            "회의일자를 입력한 뒤 임시저장이 정상 처리된다.",
            "임시저장 회의록을 다시 열었을 때 회의 정보와 본문이 유지된다.",
            "등록 및 공유 후 표시번호가 생성되고 상태가 등록으로 바뀐다.",
            "등록된 회의록은 열람 권한이 있는 사용자에게 보인다.",
        ],
        images["meeting"],
        "화면 예시 6 회의 정보와 본문을 입력하는 회의록 등록 화면",
    )

    page_break(doc)

    # Action item
    add_test_case(
        doc,
        "UT 06",
        "회의 지시사항을 액션으로 배정",
        "회의 서기",
        "등록된 회의록을 연결하고 부서별 액션을 배정할 수 있는지 확인합니다.",
        "UT 05 회의록과 공통 연습 데이터의 액션 3건",
        [
            "액션아이템 등록 메뉴에서 UT 05의 회의록을 선택합니다.",
            "회의구분과 일자가 자동 입력되는지 확인합니다.",
            "액션 행을 세 개 추가하고 부서, 주제, 요청 사항을 입력합니다.",
            "각 액션의 기한을 공통 연습 데이터에 맞게 입력합니다.",
            "등록 및 배정을 누릅니다.",
            "완료 메시지에서 액션트래킹으로 이동합니다.",
        ],
        [
            "회의록 선택 시 회의구분과 일자가 자동으로 표시된다.",
            "필수값 누락 또는 잘못된 부서에는 저장 전에 오류가 표시된다.",
            "등록 후 각 부서의 액션트래킹에 항목이 생성된다.",
            "같은 입력으로 중복 배정되지 않는다.",
        ],
        images["action"],
        "화면 예시 7 회의록 연결과 부서별 액션 등록",
    )

    page_break(doc)

    # Tracking
    add_test_case(
        doc,
        "UT 07",
        "액션 진행내용과 기한 등록",
        "액션이 배정된 부서의 팀원 또는 팀장",
        "배정된 액션을 열고 진행 상태, 진행내용, 기한을 등록할 수 있는지 확인합니다.",
        "[TEST] 기술문서 누락 항목 보완, 기한 2026년 10월 23일",
        [
            "액션트래킹 메뉴에서 RA팀을 선택하고 완료 숨김 상태를 확인합니다.",
            "제목 검색으로 테스트 액션을 찾고 항목을 펼칩니다.",
            "진행 등록을 누릅니다.",
            "진행여부를 진행중으로 선택합니다.",
            "진행내용에 누락 3종 중 2종 보완 완료, 1종 번역 검토 중을 입력합니다.",
            "기한을 2026년 10월 23일로 입력하고 저장합니다.",
            "같은 항목에 진행 등록을 다시 열어 완료를 선택하고 저장합니다.",
        ],
        [
            "진행일은 현재 날짜로 자동 기록된다.",
            "사용자가 입력하는 날짜 필드는 등록일이 아니라 기한으로 표시된다.",
            "저장한 진행내용이 진행 이력에 시간순으로 추가된다.",
            "완료 처리 후 완료 상태와 완료일이 표시되고 미완료 목록에서 제외된다.",
        ],
        images["tracking"],
        "화면 예시 8 액션 상세와 진행 등록 영역",
    )

    page_break(doc)

    # AI bot
    add_test_case(
        doc,
        "UT 08",
        "AI봇에서 진행 상황 확인",
        "전체 사용자",
        "보고서, 회의록, 액션 데이터에 질문하고 답변 근거로 원본 화면을 찾을 수 있는지 확인합니다.",
        "질문 [TEST] M Dent 출시 준비에서 아직 완료되지 않은 업무와 담당 부서를 정리해줘",
        [
            "AI봇 메뉴에서 새 대화를 시작합니다.",
            "조회 범위와 기간을 현재 주차 또는 최근 한 달로 설정합니다.",
            "연습 질문을 입력하고 전송합니다.",
            "답변의 업무명, 담당 부서, 진행상태를 확인합니다.",
            "답변 아래 출처 버튼을 선택해 원본 보고서 또는 액션 화면으로 이동합니다.",
            "원본 데이터와 AI 답변이 일치하는지 비교합니다.",
        ],
        [
            "AI봇은 시스템에 등록된 데이터 범위 안에서 답변한다.",
            "답변에 보고서, 회의록 또는 액션트래킹 출처가 표시된다.",
            "출처를 누르면 해당 화면과 항목으로 이동한다.",
            "자료가 없는 질문에는 근거가 없음을 알 수 있는 안내가 표시된다.",
        ],
        images["bot"],
        "화면 예시 9 AI봇의 질문 입력과 출처 기반 답변",
    )

    page_break(doc)

    # Admin
    add_test_case(
        doc,
        "UT 09",
        "마스터와 사원 권한 확인",
        "시스템 관리자",
        "관리자가 부서, 보고 구분, 세부내용, 사원 권한을 찾고 수정 조건을 이해할 수 있는지 확인합니다.",
        "조회만 수행하며 실제 운영 마스터는 변경하지 않음",
        [
            "마스터 관리에서 부서 탭을 열고 팀 코드, 팀명, 팀장, 사용 여부를 확인합니다.",
            "구분 및 세부내용 탭에서 KPI와 일반 아래의 세부내용을 펼칩니다.",
            "타이틀 건수 배지를 눌러 연결된 주간업무 타이틀과 최근 이력을 확인합니다.",
            "사원 및 권한 메뉴에서 팀, 역할, 상태 필터를 적용합니다.",
            "사원 한 명의 상세 패널을 열어 회의 서기와 시스템 관리자 권한을 확인합니다.",
            "역할별 권한 탭에서 팀원, 팀장, 임원, 관리자 차이를 확인합니다.",
        ],
        [
            "사용 중인 팀이나 세부내용은 연결 데이터 때문에 삭제할 수 없다는 이유가 표시된다.",
            "타이틀 건수에서 실제 연결 타이틀과 마지막 보고 상태를 확인할 수 있다.",
            "사원 검색과 필터 결과가 일치한다.",
            "관리자에게만 관리 메뉴와 관리자 기능이 표시된다.",
        ],
        images["master"],
        "화면 예시 10 부서와 보고 구분을 관리하는 마스터 화면",
    )
    add_screenshot(doc, images["employee"], "화면 예시 11 사원 목록과 역할별 권한")

    page_break(doc)

    # End-to-end verification
    doc.add_heading("업무 흐름 최종 확인", level=1)
    p(doc, "아래 순서대로 데이터가 이어지면 핵심 업무 흐름이 정상입니다. 각 단계의 식별값이나 제목이 다음 화면에서도 같은지 확인합니다.")
    add_table(
        doc,
        ["단계", "생성 또는 변경 내용", "다음 화면에서 확인할 결과"],
        [
            ["주간보고", "[TEST] 유럽 인증 자료 보완 작성", "대시보드 제출 현황과 주간보고 검색에 표시"],
            ["회의록", "[TEST] M Dent 출시 점검 등록", "액션아이템의 연결 회의록 목록에 표시"],
            ["액션 배정", "RA팀, 생산팀, 사업개발 덴탈 3건", "각 부서 액션트래킹에 같은 주제와 기한 표시"],
            ["진행 등록", "진행중 후 완료 처리", "대시보드 완료 건수와 액션 이력에 반영"],
            ["AI 조회", "미완료 업무 질문", "원본 데이터와 일치하는 답변 및 출처 표시"],
        ],
        widths=[1.0, 2.75, 2.95],
        font_size=9.4,
    )
    doc.add_heading("오류가 발생했을 때 기록할 정보", level=2)
    add_checklist(doc, [
        "화면명과 수행 중이던 테스트 ID",
        "입력한 값과 누른 버튼",
        "예상한 결과와 실제로 나타난 결과",
        "발생 시각과 사용한 브라우저",
        "가능하면 오류 메시지가 보이는 화면 캡처",
        "재시도했을 때 같은 문제가 발생했는지 여부",
    ])
    doc.add_heading("테스트 데이터 정리", level=2)
    add_steps(doc, [
        "검색창에서 [TEST]를 입력해 본인이 만든 주간보고, 회의록, 액션을 찾습니다.",
        "삭제 권한이 있는 항목은 평가 진행자의 안내에 따라 삭제합니다.",
        "연결 데이터 때문에 삭제할 수 없는 항목은 사용 해제하거나 삭제 목록에 기록합니다.",
        "평가표와 결함 기록표를 테스트 진행자에게 전달합니다.",
    ])

    page_break(doc)

    # Evaluation form
    doc.add_heading("사용자 평가표", level=1)
    p(doc, "각 항목을 1점에서 5점으로 평가합니다. 1점은 매우 어렵거나 불명확함, 5점은 매우 쉽고 명확함을 뜻합니다.")
    add_label_value(doc, "평가자", "____________________________")
    add_label_value(doc, "배정 역할", "팀원  ☐   팀장  ☐   회의 서기  ☐   임원  ☐   관리자  ☐")
    add_label_value(doc, "평가 일시", "2026년 ____월 ____일 ____시")
    doc.add_heading("사용 편의성", level=2)
    add_score_line(doc, "메뉴 이름만 보고 원하는 기능을 찾을 수 있었다")
    add_score_line(doc, "입력 항목과 필수값을 쉽게 이해할 수 있었다")
    add_score_line(doc, "저장 또는 등록 결과를 명확히 확인할 수 있었다")
    add_score_line(doc, "오류 메시지가 문제 해결에 도움이 되었다")
    add_score_line(doc, "화면의 글자 크기와 간격이 읽기 편했다")
    doc.add_heading("업무 적합성", level=2)
    add_score_line(doc, "주간업무보고 작성 흐름이 실제 업무 방식과 맞았다")
    add_score_line(doc, "회의록에서 액션 배정까지의 연결이 자연스러웠다")
    add_score_line(doc, "액션의 진행상태와 이력을 쉽게 파악할 수 있었다")
    add_score_line(doc, "AI 답변과 원본 출처를 신뢰할 수 있었다")
    add_score_line(doc, "다시 사용할 의향이 있다")
    doc.add_page_break()
    doc.add_heading("자유 의견", level=1)
    p(doc, "정해진 점수만으로 설명하기 어려운 경험을 구체적으로 적어 주세요. 개선 의견에는 문제가 발생한 화면과 원하는 처리 방식을 함께 적으면 도움이 됩니다.")
    add_table(
        doc,
        ["질문", "의견"],
        [
            ["가장 편리했던 기능", "\n\n"],
            ["가장 어려웠던 기능", "\n\n"],
            ["업무에 꼭 필요한 개선", "\n\n"],
            ["추가되면 좋은 기능", "\n\n"],
        ],
        widths=[2.0, 4.7],
        font_size=9.8,
    )

    page_break(doc)

    # Execution sheet
    doc.add_heading("테스트 수행 결과표", level=1)
    add_table(
        doc,
        ["테스트", "성공", "부분 성공", "실패", "해당 없음", "비고"],
        [
            ["UT 01 로그인", "☐", "☐", "☐", "☐", ""],
            ["UT 02 대시보드", "☐", "☐", "☐", "☐", ""],
            ["UT 03 주간업무 작성", "☐", "☐", "☐", "☐", ""],
            ["UT 04 보류와 재개", "☐", "☐", "☐", "☐", ""],
            ["UT 05 회의록", "☐", "☐", "☐", "☐", ""],
            ["UT 06 액션 배정", "☐", "☐", "☐", "☐", ""],
            ["UT 07 진행 등록", "☐", "☐", "☐", "☐", ""],
            ["UT 08 AI봇", "☐", "☐", "☐", "☐", ""],
            ["UT 09 관리자", "☐", "☐", "☐", "☐", ""],
        ],
        widths=[1.65, 0.72, 0.95, 0.72, 0.95, 1.7],
        font_size=8.9,
    )
    doc.add_heading("결함 기록표", level=2)
    add_table(
        doc,
        ["번호", "테스트 ID", "화면과 재현 절차", "예상 결과", "실제 결과", "심각도"],
        [
            ["1", "", "\n\n\n", "\n\n", "\n\n", "상  중  하"],
            ["2", "", "\n\n\n", "\n\n", "\n\n", "상  중  하"],
            ["3", "", "\n\n\n", "\n\n", "\n\n", "상  중  하"],
        ],
        widths=[0.45, 0.72, 2.2, 1.25, 1.25, 0.85],
        font_size=8.7,
    )
    doc.add_heading("종합 판정", level=2)
    add_checklist(doc, [
        "시범 운영 가능",
        "경미한 수정 후 시범 운영 가능",
        "핵심 오류 수정 후 재평가 필요",
    ])
    add_label_value(doc, "평가자 서명", "____________________________")
    add_label_value(doc, "테스트 진행자 확인", "____________________________")
    doc.add_heading("제출 전 마지막 확인", level=2)
    add_checklist(doc, [
        "테스트 수행 결과표의 모든 항목을 표시했다.",
        "재현 가능한 오류는 결함 기록표에 남겼다.",
        "[TEST]로 만든 데이터의 삭제 또는 정리 대상을 전달했다.",
        "평가자 서명과 테스트 진행자 확인을 완료했다.",
    ])

    # Ensure section defaults and metadata
    doc.core_properties.title = "MetaWork 사용자 테스트 매뉴얼"
    doc.core_properties.subject = "주간업무보고와 회의 액션 관리 사용자 테스트"
    doc.core_properties.author = "MetaWork 운영팀"
    doc.core_properties.keywords = "MetaWork, 사용자 테스트, 주간업무보고, 회의록, 액션트래킹"
    doc.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    build()
