import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";
import type { DataTableSortDetail } from "../../data-table";
import { invokeCommand } from "@excom/neutron";

/** Invoke `--export` from a button carrying `data` as `data-*`, and settle. */
const exportWith = async (
  table: Element,
  data: Record<string, unknown> = {},
) => {
  const button = document.createElement("button");
  Object.entries(data).forEach(([key, value]) => {
    button.dataset[key] = String(value);
  });
  invokeCommand(table, "--export", button);
  await Promise.resolve();
};

const rowOrder = (tr: HTMLElement) =>
  parseInt(tr.style.getPropertyValue("--data-tr-order") || "0", 10);

const isFilteredOut = (tr: HTMLElement) =>
  tr.style.getPropertyValue("--data-tr-display") === "none";

describe("data-table", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("sorts table", async () => {
    const dataTable = fixture<HTMLDataTableElement>(
      `<data-table>
        <data-thead>
          <data-tr>
            <data-th sort-direction="desc" column-type="string">Name</data-th>
            <data-th column-type="number">Age</data-th>
            <data-th column-type="date">Birthday</data-th>
          </data-tr>
        </data-thead>
        <data-tbody>
          <data-tr>
            <data-td>John Doe</data-td>
            <data-td>49</data-td>
            <data-td>1974-10-01</data-td>
          </data-tr>
          <data-tr>
            <data-td>Jane Doe</data-td>
            <data-td>45</data-td>
            <data-td>1978-10-01</data-td>
          </data-tr>
        </data-tbody>
      </data-table>`,
    );
    const ths = dataTable.querySelectorAll("data-th");
    const dataTbody = dataTable.querySelector("data-tbody")!;
    const dataTrs = dataTbody.querySelectorAll("data-tr");
    const johnTr = dataTrs[0] as HTMLElement;
    const janeTr = dataTrs[1] as HTMLElement;
    expect(ths[0]).dom.to.equalTag(
      `<data-th column-type="string" sort-direction="desc"></data-th>`,
    );
    // Default action of data-table-sort is delayed one macrotask
    await wait(0);
    expect(dataTbody.firstElementChild).toBe(johnTr);
    expect(dataTbody.lastElementChild).toBe(janeTr);
    expect(rowOrder(johnTr)).toBe(1);
    expect(rowOrder(janeTr)).toBe(2);

    // Sort by name asc, by clicking the header
    await waitForEvent(dataTable, "data-table-sort", () => {
      ths[0].dispatchEvent(new CustomEvent("click", { bubbles: true }));
    });
    await wait(0);
    expect(ths[0]).dom.to.equalTag(
      `<data-th column-type="string" sort-direction="asc"></data-th>`,
    );
    expect(dataTbody.firstElementChild).toBe(johnTr);
    expect(rowOrder(janeTr)).toBe(1);
    expect(rowOrder(johnTr)).toBe(2);

    // sort by age asc
    await waitForEvent(dataTable, "data-table-sort", () => {
      ths[1].dispatchEvent(new CustomEvent("click", { bubbles: true }));
    });
    await wait(0);
    expect(ths[1]).dom.to.equalTag(
      `<data-th column-type="number" sort-direction="asc"></data-th>`,
    );
    expect(rowOrder(janeTr)).toBe(1);
    expect(rowOrder(johnTr)).toBe(2);

    // sort by age desc
    await waitForEvent(dataTable, "data-table-sort", () => {
      ths[1].dispatchEvent(new CustomEvent("click", { bubbles: true }));
    });
    await wait(0);
    expect(ths[1]).dom.to.equalTag(
      `<data-th column-type="number" sort-direction="desc"></data-th>`,
    );
    expect(rowOrder(johnTr)).toBe(1);
    expect(rowOrder(janeTr)).toBe(2);

    // sort by birthday asc
    await waitForEvent(dataTable, "data-table-sort", () => {
      ths[2].dispatchEvent(new CustomEvent("click", { bubbles: true }));
    });
    await wait(0);
    expect(ths[2]).dom.to.equalTag(
      `<data-th column-type="date" sort-direction="asc"></data-th>`,
    );
    expect(rowOrder(janeTr)).toBe(1);
    expect(rowOrder(johnTr)).toBe(2);

    // sort by birthday desc
    await waitForEvent(dataTable, "data-table-sort", () => {
      ths[2].dispatchEvent(new CustomEvent("click", { bubbles: true }));
    });
    await wait(0);
    expect(ths[2]).dom.to.equalTag(
      `<data-th column-type="date" sort-direction="desc"></data-th>`,
    );
    expect(rowOrder(johnTr)).toBe(1);
    expect(rowOrder(janeTr)).toBe(2);
    expect(dataTbody.firstElementChild).toBe(johnTr);
    expect(dataTbody.lastElementChild).toBe(janeTr);
  });

  it("filters table", async () => {
    const dataTable = fixture<HTMLDataTableElement>(
      `<data-table>
        <data-thead>
          <data-tr>
            <data-th column-type="string">Name</data-th>
            <data-th column-type="number">Age</data-th>
            <data-th column-type="date">Birthday</data-th>
          </data-tr>
        </data-thead>
        <data-tbody>
          <data-tr>
            <data-td>John Doe</data-td>
            <data-td>49</data-td>
            <data-td>1974-10-01</data-td>
          </data-tr>
          <data-tr>
            <data-td>Jane Doe</data-td>
            <data-td>45</data-td>
            <data-td>1978-10-01</data-td>
          </data-tr>
        </data-tbody>
      </data-table>`,
    );
    const dataTbody = dataTable.querySelector("data-tbody")!;
    const dataTrs = dataTbody.querySelectorAll("data-tr");
    const johnTr = dataTrs[0] as HTMLElement;
    const janeTr = dataTrs[1] as HTMLElement;

    expect(isFilteredOut(johnTr)).toBe(false);
    expect(isFilteredOut(janeTr)).toBe(false);

    dataTable.filterValue = "jane";
    expect(isFilteredOut(johnTr)).toBe(true);
    expect(isFilteredOut(janeTr)).toBe(false);

    dataTable.filterCasing = true;

    expect(isFilteredOut(johnTr)).toBe(true);
    expect(isFilteredOut(janeTr)).toBe(true);

    dataTable.filterValue = "John";

    expect(isFilteredOut(johnTr)).toBe(false);
    expect(isFilteredOut(janeTr)).toBe(true);

    dataTable.filterValue = "john";

    expect(isFilteredOut(johnTr)).toBe(true);
    expect(isFilteredOut(janeTr)).toBe(true);

    dataTable.filterCasing = false;

    expect(isFilteredOut(johnTr)).toBe(false);
    expect(isFilteredOut(janeTr)).toBe(true);

    dataTable.filterValue = null;

    expect(isFilteredOut(johnTr)).toBe(false);
    expect(isFilteredOut(janeTr)).toBe(false);
    expect(dataTbody.firstElementChild).toBe(johnTr);
    expect(dataTbody.lastElementChild).toBe(janeTr);
  });

  it("exports visible rows as csv / json", async () => {
    const dataTable = fixture<HTMLDataTableElement>(
      `<data-table>
        <data-thead>
          <data-tr>
            <data-th column-type="string">Name</data-th>
            <data-th column-type="number">Age</data-th>
          </data-tr>
        </data-thead>
        <data-tbody>
          <data-tr>
            <data-td>John Doe</data-td>
            <data-td>49</data-td>
          </data-tr>
          <data-tr>
            <data-td>Jane Doe</data-td>
            <data-td>45</data-td>
          </data-tr>
        </data-tbody>
      </data-table>`,
    );
    dataTable.filterValue = "jane";

    const csv = await captureDownload(() => exportWith(dataTable));
    expect(csv.download).toMatch(/^export_table_.*\.csv$/);
    expect(csv.href).toMatch(/^data:text\/csv;charset=utf-8,/);
    const csvBody = decodeURIComponent(
      csv.href.replace("data:text/csv;charset=utf-8,", ""),
    );
    expect(csvBody).toContain("Jane Doe");
    expect(csvBody).not.toContain("John Doe");
    expect(csvBody).toContain("Name");

    const json = await captureDownload(() => exportWith(dataTable, { fileType: "json", fileName: "people" }));
    expect(json.download).toBe("people.json");
    const jsonBody = JSON.parse(
      decodeURIComponent(
        json.href.replace("data:text/json;charset=utf-8,", ""),
      ),
    );
    expect(jsonBody).toEqual([{ Name: "Jane Doe", Age: "45" }]);

    const fullCsv = await captureDownload(() => exportWith(dataTable, { full: true }));
    const fullBody = decodeURIComponent(
      fullCsv.href.replace("data:text/csv;charset=utf-8,", ""),
    );
    expect(fullBody).toContain("John Doe");
    expect(fullBody).toContain("Jane Doe");

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const none = await captureDownload(() => exportWith(dataTable, { fileType: "xml" }));
    expect(none.href).toBe("");
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatch(/invalid data-file-type "xml"/);
  });
});

async function captureDownload(trigger: () => void | Promise<void>) {
  const captured: { href: string; download: string } = {
    href: "",
    download: "",
  };
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click() {
    captured.href = this.getAttribute("href") ?? "";
    captured.download = this.getAttribute("download") ?? "";
  };
  try {
    await trigger();
  } finally {
    HTMLAnchorElement.prototype.click = orig;
  }
  return captured;
}

describe("data-table (sort edge cases)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const twoRows = `
    <data-tbody>
      <data-tr>
        <data-td>John Doe</data-td>
        <data-td>49</data-td>
      </data-tr>
      <data-tr>
        <data-td>Jane Doe</data-td>
        <data-td>45</data-td>
      </data-tr>
    </data-tbody>`;

  /** Build a table, attach a `data-table-sort` spy, then connect it. */
  const connectWithSpy = async (inner: string) => {
    const table = document.createElement("data-table") as HTMLDataTableElement;
    table.innerHTML = inner;
    const sortSpy = vi.fn();
    table.addEventListener("data-table-sort", sortSpy);
    document.body.append(table);
    await wait(0);
    return { table, sortSpy };
  };

  it("does not sort on connect without a data-tbody", async () => {
    const { sortSpy } = await connectWithSpy(
      `<data-thead><data-tr><data-th sort-direction="asc">Name</data-th></data-tr></data-thead>`,
    );
    expect(sortSpy).not.toHaveBeenCalled();
  });

  it("does not sort a single-row table", async () => {
    const { table, sortSpy } = await connectWithSpy(
      `<data-thead><data-tr><data-th sort-direction="asc">Name</data-th></data-tr></data-thead>
       <data-tbody><data-tr><data-td>Only</data-td></data-tr></data-tbody>`,
    );
    expect(sortSpy).not.toHaveBeenCalled();
    expect(rowOrder(table.querySelector("data-tbody > data-tr")!)).toBe(0);
  });

  it("does not sort on connect when no header is active", async () => {
    const { table, sortSpy } = await connectWithSpy(
      `<data-thead><data-tr><data-th>Name</data-th><data-th>Age</data-th></data-tr></data-thead>
       ${twoRows}`,
    );
    expect(sortSpy).not.toHaveBeenCalled();
    expect(table.activeDataTh).toBe(null);
    table.querySelectorAll("data-tbody > data-tr").forEach((tr) => {
      expect(rowOrder(tr as HTMLElement)).toBe(0);
    });
  });

  it("sorts on connect when a header already carries sort-direction", async () => {
    const { table, sortSpy } = await connectWithSpy(
      `<data-thead><data-tr><data-th>Name</data-th><data-th sort-direction="asc" column-type="number">Age</data-th></data-tr></data-thead>
       ${twoRows}`,
    );
    expect(sortSpy).toHaveBeenCalledTimes(1);
    const detail = sortSpy.mock.calls[0][0].detail as DataTableSortDetail;
    expect(detail.sortDirection).toBe("asc");
    expect(detail.columnType).toBe("number");
    expect(detail.columnIndex).toBe(1);
    expect(detail.rows).toHaveLength(2);
    const [john, jane] = [
      ...table.querySelectorAll("data-tbody > data-tr"),
    ] as HTMLElement[];
    expect(rowOrder(jane)).toBe(1);
    expect(rowOrder(john)).toBe(2);
  });

  it("defaults to desc / string when the active header has no sort-direction or column-type", async () => {
    const { table, sortSpy } = await connectWithSpy(
      `<data-thead><data-tr><data-th>Name</data-th><data-th>Age</data-th></data-tr></data-thead>
       ${twoRows}`,
    );
    const nameTh = table.querySelector("data-th")!;
    // a `data-th-sort` that did not come from a sort-direction change
    nameTh.dispatchEvent(new CustomEvent("data-th-sort", { bubbles: true }));
    await wait(0);
    expect(sortSpy).toHaveBeenCalledTimes(1);
    const detail = sortSpy.mock.calls[0][0].detail as DataTableSortDetail;
    expect(detail.sortDirection).toBe("desc");
    expect(detail.columnType).toBe("string");
    expect(detail.columnIndex).toBe(0);
    const [john, jane] = [
      ...table.querySelectorAll("data-tbody > data-tr"),
    ] as HTMLElement[];
    expect(rowOrder(john)).toBe(1);
    expect(rowOrder(jane)).toBe(2);
  });

  it("treats a missing cell as an empty string when sorting", async () => {
    const dataTable = fixture<HTMLDataTableElement>(
      `<data-table>
        <data-thead>
          <data-tr>
            <data-th>Name</data-th>
            <data-th>Age</data-th>
          </data-tr>
        </data-thead>
        <data-tbody>
          <data-tr>
            <data-td>Short row</data-td>
          </data-tr>
          <data-tr>
            <data-td>Jane Doe</data-td>
            <data-td>45</data-td>
          </data-tr>
          <data-tr>
            <data-td>Other short row</data-td>
          </data-tr>
        </data-tbody>
      </data-table>`,
    );
    const ths = dataTable.querySelectorAll("data-th");
    const [short, jane, otherShort] = [
      ...dataTable.querySelectorAll("data-tbody > data-tr"),
    ] as HTMLElement[];
    await waitForEvent(dataTable, "data-table-sort", () => {
      ths[1].dispatchEvent(new CustomEvent("click", { bubbles: true }));
    });
    await wait(0);
    expect(ths[1].getAttribute("sort-direction")).toBe("asc");
    // "" sorts before "45"; the two empty cells keep their relative order
    expect(rowOrder(short)).toBe(1);
    expect(rowOrder(otherShort)).toBe(2);
    expect(rowOrder(jane)).toBe(3);
    // DOM order is untouched
    expect(dataTable.querySelector("data-tbody")!.firstElementChild).toBe(
      short,
    );
  });

  it("skips the default sort when data-table-sort is prevented", async () => {
    const dataTable = fixture<HTMLDataTableElement>(
      `<data-table>
        <data-thead><data-tr><data-th>Name</data-th><data-th>Age</data-th></data-tr></data-thead>
        ${twoRows}
      </data-table>`,
    );
    dataTable.addEventListener("data-table-sort", (e) => e.preventDefault());
    const ths = dataTable.querySelectorAll("data-th");
    await waitForEvent(dataTable, "data-table-sort", () => {
      ths[0].dispatchEvent(new CustomEvent("click", { bubbles: true }));
    });
    await wait(0);
    expect(ths[0].getAttribute("sort-direction")).toBe("asc");
    expect(dataTable.activeDataTh).toBe(ths[0]);
    dataTable.querySelectorAll("data-tbody > data-tr").forEach((tr) => {
      expect(
        (tr as HTMLElement).style.getPropertyValue("--data-tr-order"),
      ).toBe("");
    });
  });

  it("ignores a data-table-sort without rows", async () => {
    const dataTable = fixture<HTMLDataTableElement>(
      `<data-table>
        <data-thead><data-tr><data-th>Name</data-th></data-tr></data-thead>
        ${twoRows}
      </data-table>`,
    );
    dataTable.dispatchEvent(
      new CustomEvent("data-table-sort", {
        cancelable: true,
        detail: { columnIndex: 0, sortFn: () => 0, rows: [] },
      }),
    );
    dataTable.dispatchEvent(
      new CustomEvent("data-table-sort", { cancelable: true, detail: {} }),
    );
    await wait(0);
    dataTable.querySelectorAll("data-tbody > data-tr").forEach((tr) => {
      expect(rowOrder(tr as HTMLElement)).toBe(0);
    });
  });

  it("moves the active header and clears sort-direction on the previous one", async () => {
    const dataTable = fixture<HTMLDataTableElement>(
      `<data-table>
        <data-thead><data-tr><data-th sort-direction="desc">Name</data-th><data-th>Age</data-th></data-tr></data-thead>
        ${twoRows}
      </data-table>`,
    );
    const ths = dataTable.querySelectorAll("data-th");
    await wait(0);
    expect(dataTable.activeDataTh).toBe(ths[0]);
    await waitForEvent(dataTable, "data-table-sort", () => {
      ths[1].dispatchEvent(new CustomEvent("click", { bubbles: true }));
    });
    await wait(0);
    expect(dataTable.activeDataTh).toBe(ths[1]);
    expect(ths[0]).dom.to.equalTag(`<data-th></data-th>`);
    expect(ths[1]).dom.to.equalTag(`<data-th sort-direction="asc"></data-th>`);
  });
});

describe("data-table (provision)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const buildTable = (nameThAttrs = "") =>
    fixture<HTMLDataTableElement>(
      `<data-table>
        <data-thead>
          <data-tr>
            <data-th column-type="string" ${nameThAttrs}>Name</data-th>
            <data-th column-type="number">Age</data-th>
          </data-tr>
        </data-thead>
        <data-tbody>
          <data-tr>
            <data-td>John Doe</data-td>
            <data-td>49</data-td>
          </data-tr>
          <data-tr>
            <data-td>Jane Doe</data-td>
            <data-td>45</data-td>
          </data-tr>
          <data-tr>
            <data-td>Ada Lovelace</data-td>
            <data-td>36</data-td>
          </data-tr>
        </data-tbody>
      </data-table>`,
    );

  it("reports the row count and no sort / filter after connect", async () => {
    const dataTable = buildTable();
    expect(dataTable.provision).toEqual({
      totalRows: 3,
      visibleRows: 3,
      sortColumnIndex: null,
      sortDirection: null,
      filterValue: null,
    });
  });

  it("reports an initial sort-direction header on connect", async () => {
    const dataTable = buildTable(`sort-direction="asc"`);
    expect(dataTable.provision).toEqual(
      expect.objectContaining({ sortColumnIndex: 0, sortDirection: "asc" }),
    );
    await wait(0);
    expect(dataTable.provision?.totalRows).toBe(3);
  });

  it("updates the sort facts after a header click", async () => {
    const dataTable = buildTable();
    const ths = dataTable.querySelectorAll("data-th");
    const provisionSpy = vi.fn();
    dataTable.addEventListener("neutron-provision", provisionSpy);

    await waitForEvent(dataTable, "data-table-sort", () => {
      ths[1].dispatchEvent(new CustomEvent("click", { bubbles: true }));
    });
    // the default action runs one macrotask later
    await wait(0);
    expect(dataTable.provision).toEqual({
      totalRows: 3,
      visibleRows: 3,
      sortColumnIndex: 1,
      sortDirection: "asc",
      filterValue: null,
    });
    expect(provisionSpy).toHaveBeenCalledTimes(1);

    await waitForEvent(dataTable, "data-table-sort", () => {
      ths[1].dispatchEvent(new CustomEvent("click", { bubbles: true }));
    });
    await wait(0);
    expect(dataTable.provision).toEqual(
      expect.objectContaining({ sortColumnIndex: 1, sortDirection: "desc" }),
    );

    await waitForEvent(dataTable, "data-table-sort", () => {
      ths[0].dispatchEvent(new CustomEvent("click", { bubbles: true }));
    });
    await wait(0);
    expect(dataTable.provision).toEqual(
      expect.objectContaining({ sortColumnIndex: 0, sortDirection: "asc" }),
    );
    expect(provisionSpy).toHaveBeenCalledTimes(3);
  });

  it("counts visible rows after a filter and again after clearing it", async () => {
    const dataTable = buildTable();

    dataTable.filterValue = "doe";
    expect(dataTable.provision).toEqual({
      totalRows: 3,
      visibleRows: 2,
      sortColumnIndex: null,
      sortDirection: null,
      filterValue: "doe",
    });

    dataTable.filterValue = "ada";
    expect(dataTable.provision).toEqual(
      expect.objectContaining({ visibleRows: 1, filterValue: "ada" }),
    );

    dataTable.filterCasing = true;
    expect(dataTable.provision).toEqual(
      expect.objectContaining({ visibleRows: 0, filterValue: "ada" }),
    );

    dataTable.filterValue = "";
    expect(dataTable.provision).toEqual({
      totalRows: 3,
      visibleRows: 3,
      sortColumnIndex: null,
      sortDirection: null,
      filterValue: null,
    });
  });

  it("keeps the same object when nothing changed", async () => {
    const dataTable = buildTable();
    const before = dataTable.provision;
    dataTable.filterValue = "zzz-no-match";
    expect(dataTable.provision).not.toBe(before);
    expect(dataTable.provision?.visibleRows).toBe(0);
    const filtered = dataTable.provision;
    // a filter-casing flip that hides the same rows is a no-op
    dataTable.filterCasing = true;
    expect(dataTable.provision).toBe(filtered);
  });

  it("tolerates a table without a data-tbody", async () => {
    const dataTable = fixture<HTMLDataTableElement>(
      `<data-table>
        <data-thead><data-tr><data-th>Name</data-th></data-tr></data-thead>
      </data-table>`,
    );
    expect(dataTable.provision).toEqual({
      totalRows: 0,
      visibleRows: 0,
      sortColumnIndex: null,
      sortDirection: null,
      filterValue: null,
    });
  });
});

describe("data-table (filter / export edge cases)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const buildTable = () =>
    fixture<HTMLDataTableElement>(
      `<data-table>
        <data-thead>
          <data-tr>
            <data-th column-type="string">Name</data-th>
            <data-th column-type="number">Age</data-th>
          </data-tr>
        </data-thead>
        <data-tbody>
          <data-tr>
            <data-td>John Doe</data-td>
            <data-td>49</data-td>
          </data-tr>
          <data-tr>
            <data-td>Jane Doe</data-td>
            <data-td>45</data-td>
          </data-tr>
        </data-tbody>
      </data-table>`,
    );

  it("exports in visual sort order, normalises file type and escapes quotes", async () => {
    const dataTable = buildTable();
    const ths = dataTable.querySelectorAll("data-th");
    dataTable.querySelector("data-td")!.textContent = 'John "JD" Doe';
    await waitForEvent(dataTable, "data-table-sort", () => {
      ths[0].dispatchEvent(new CustomEvent("click", { bubbles: true }));
    });
    await wait(0);
    const csv = await captureDownload(() => exportWith(dataTable, { fileType: " CSV ", fileName: "  " }));
    expect(csv.download).toMatch(/^export_table_.*\.csv$/);
    const body = decodeURIComponent(
      csv.href.replace("data:text/csv;charset=utf-8,", ""),
    );
    const lines = body.split("\n");
    expect(lines[0]).toBe('"Name","Age"');
    // asc by name: Jane before John, regardless of DOM order
    expect(lines[1]).toBe('"Jane Doe","45"');
    expect(lines[2]).toBe('"John ""JD"" Doe","49"');
  });

  it("exports every row in DOM order with full even when filtered", async () => {
    const dataTable = buildTable();
    dataTable.filterValue = "jane";
    const json = await captureDownload(() => exportWith(dataTable, { full: true, fileType: "json", fileName: "all" }));
    expect(json.download).toBe("all.json");
    expect(
      JSON.parse(
        decodeURIComponent(
          json.href.replace("data:text/json;charset=utf-8,", ""),
        ),
      ),
    ).toEqual([
      { Name: "John Doe", Age: "49" },
      { Name: "Jane Doe", Age: "45" },
    ]);
  });

  it("treats full: false like an omitted full", async () => {
    const dataTable = buildTable();
    dataTable.filterValue = "jane";
    const csv = await captureDownload(() => exportWith(dataTable, { full: false }));
    const body = decodeURIComponent(
      csv.href.replace("data:text/csv;charset=utf-8,", ""),
    );
    expect(body).toContain("Jane Doe");
    expect(body).not.toContain("John Doe");
  });
});
