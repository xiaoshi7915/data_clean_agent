// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RulesToolbar } from "./RulesToolbar";

describe("RulesToolbar", () => {
  afterEach(() => {
    cleanup();
  });

  it("无契约回调时不渲染", () => {
    const { container } = render(<RulesToolbar rulesCount={1} isLoading={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("有规则时显示导出按钮", () => {
    render(
      <RulesToolbar
        rulesCount={2}
        isLoading={false}
        onExportYaml={vi.fn()}
        onExportJson={vi.fn()}
      />
    );
    expect(screen.getByText("导出 YAML")).toBeInTheDocument();
    expect(screen.getByText("导出 JSON")).toBeInTheDocument();
  });

  it("无规则时导出按钮禁用", () => {
    render(
      <RulesToolbar rulesCount={0} isLoading={false} onExportYaml={vi.fn()} />
    );
    expect(screen.getByText("导出 YAML")).toBeDisabled();
  });

  it("点击导入契约打开对话框", () => {
    render(
      <RulesToolbar
        rulesCount={1}
        isLoading={false}
        onImportContract={vi.fn().mockResolvedValue(true)}
      />
    );
    fireEvent.click(screen.getByText("导入契约"));
    expect(screen.getByText("导入清洗契约")).toBeInTheDocument();
  });
});
