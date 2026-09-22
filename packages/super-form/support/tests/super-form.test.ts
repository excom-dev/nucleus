import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  spyFetch,
  vi,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { KitLogger } from "@excom/kit-logger";
import "../../index";

const fetchStubs = {
  success: () => ({
    status: 200,
    body: JSON.stringify({ results: [{ a: 1 }] }),
  }),
  error: () => ({
    status: 500,
    body: JSON.stringify({ message: "something broke" }),
  }),
};

const formHtml = `
<form action="/api/submit" method="put">
  <!-- Simple primitives -->
  <input type="text" name="name" value="John Doe">
  <input type="email" name="email" value="j@doe.com">
  <input type="number" name="age" value="50">
  <input type="range" name="volume" min="0" max="100" value="20">
  <input type="tel" name="phone" value="123-456-7890">
  <input type="url" name="website" value="https://example.com">
  <input type="color" name="favoriteColor" value="#ff0000">
  <input type="password" name="password" value="secret">

  <!-- Checkbox -->
  <input type="checkbox" name="isAdmin" checked>
  <input type="checkbox" name="isModerator">

  <!-- Checkbox array -->
  <input type="checkbox" name="hobbies" value="reading" checked>
  <input type="checkbox" name="hobbies" value="cooking">
  <input type="checkbox" name="hobbies" value="gaming" checked>

  <!-- Radio -->
  <input type="radio" name="activity" value="running">
  <input type="radio" name="activity" value="swimming" checked>

  <!-- Datetimes -->
  <input type="date" name="birthday" value="1999-10-01">
  <input type="time" name="wakeupTime" value="08:00">
  <input type="datetime-local" name="meetingTime" value="2023-10-01T10:00">
  <input type="month" name="birthMonth" value="1999-10">
  <input type="week" name="birthWeek" value="1999-W40">

  <!-- Select -->
  <select name="country">
    <option value="USA">United States</option>
    <option value="CAN" selected>Canada</option>
    <option value="MEX">Mexico</option>
  </select>

  <!-- Select multiple -->
  <select name="languages" multiple>
    <option value="english" selected>English</option>
    <option value="french">French</option>
    <option value="spanish" selected>Spanish</option>
    <option value="german">German</option>
    <option value="chinese">Chinese</option>
  </select>

  <!-- Arrays -->
  <input type="text" name="tags[]" value="smart">
  <input type="text" name="tags[]" value="athletic">
  <input type="text" name="tags[]" value="kind">

  <!-- Nested -->
  <input type="text" name="address.city" value="Anytown">
  <input type="text" name="address.state" value="CA">
  <input type="number" name="address.zip" value="12345">
  <input type="number" name="address.coordinates[]" value="37.7749">
  <input type="number" name="address.coordinates[]" value="-122.4194">

  <!-- Disabled -->
  <input type="text" name="disabledValue" value="test" disabled>
  <button type="submit">Submit</button>
</form>
`;
const formJson = {
  name: "John Doe",
  email: "j@doe.com",
  age: 50,
  volume: 20,
  phone: "123-456-7890",
  website: "https://example.com",
  favoriteColor: "#ff0000",
  password: "secret",
  isAdmin: true,
  isModerator: false,
  activity: "swimming",
  hobbies: ["reading", "gaming"],
  birthday: "1999-10-01",
  wakeupTime: "08:00",
  meetingTime: "2023-10-01T10:00",
  birthMonth: "1999-10",
  birthWeek: "1999-W40",
  country: "CAN",
  languages: ["english", "spanish"],
  tags: ["smart", "athletic", "kind"],
  address: {
    city: "Anytown",
    state: "CA",
    zip: 12345,
    coordinates: [37.7749, -122.4194],
  },
};

const submitForm = (superForm: HTMLSuperFormElement) => {
  superForm
    .getFormElement()!
    .dispatchEvent(new Event("submit", { bubbles: true }));
};

describe("super-form", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("sets state attributes and submits properly", async () => {
    const superForm = fixture<HTMLSuperFormElement>(
      `<super-form>${formHtml}</super-form>`,
    );
    const fetchSpy = spyFetch(fetchStubs.success() as any);

    // Assert loading in the handler: fetch can settle before an awaited
    // `waitForEvent` continuation runs.
    superForm.addEventListener("super-form-loading", () => {
      expect(superForm).dom.to.equalTag(`<super-form is-loading></super-form>`);
      expect(superForm.provision).toEqual(null);
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/submit",
        expect.objectContaining({
          method: "PUT",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: expect.toSatisfy((body: string) => {
            expect(JSON.parse(body)).toEqual(expect.objectContaining(formJson));
            return true;
          }),
        }),
      );
    });

    await waitForEvent(superForm, "super-form-success", () => {
      submitForm(superForm);
    });
    expect(superForm).dom.to.equalTag(`<super-form is-success></super-form>`);
    expect(superForm.provision?.body).toEqual({ results: [{ a: 1 }] });
  });

  it("can be configured to send a body on methods that don't usually send one", async () => {
    const superForm = fixture<HTMLSuperFormElement>(
      `<super-form has-body>${formHtml}</super-form>`,
    );
    const form = superForm.getFormElement()!;
    form.setAttribute("method", "delete");
    const fetchSpy = spyFetch(fetchStubs.success as any);

    superForm.addEventListener("super-form-loading", () => {
      expect(superForm).dom.to.equalTag(
        `<super-form is-loading has-body></super-form>`,
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/submit",
        expect.objectContaining({
          method: "DELETE",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: expect.toSatisfy((body: string) => {
            expect(JSON.parse(body)).toEqual(expect.objectContaining(formJson));
            return true;
          }),
        }),
      );
    });

    await waitForEvent(superForm, "super-form-success", () => {
      form.dispatchEvent(new Event("submit", { bubbles: true }));
    });
  });

  it("converts the form to url params if no body is sent", async () => {
    const superForm = fixture<HTMLSuperFormElement>(
      `<super-form>${formHtml}</super-form>`,
    );
    const form = superForm.getFormElement()!;
    form.setAttribute("method", "get");
    const fetchSpy = spyFetch(fetchStubs.success as any);

    await waitForEvent(superForm, "super-form-loading", () => {
      form.dispatchEvent(new Event("submit", { bubbles: true }));
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/submit?name=John+Doe&email=j%40doe.com&age=50&volume=20&phone=123-456-7890&website=https%3A%2F%2Fexample.com&favoriteColor=%23ff0000&password=secret&isAdmin=true&hobbies=%5B%22reading%22%2C%22gaming%22%5D&activity=swimming&birthday=1999-10-01&wakeupTime=08%3A00&meetingTime=2023-10-01T10%3A00&birthMonth=1999-10&birthWeek=1999-W40&country=CAN&languages=%5B%22english%22%2C%22spanish%22%5D&tags=%5B%22smart%22%2C%22athletic%22%2C%22kind%22%5D&address=%7B%22city%22%3A%22Anytown%22%2C%22state%22%3A%22CA%22%2C%22zip%22%3A12345%2C%22coordinates%22%3A%5B37.7749%2C-122.4194%5D%7D&isModerator=false",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      }),
    );
  });

  it("handles fetch error", async () => {
    const superForm = fixture<HTMLSuperFormElement>(
      `<super-form>${formHtml}</super-form>`,
    );
    const fetchSpy = spyFetch(fetchStubs.error as any);

    KitLogger.suppress();
    superForm.addEventListener("super-form-loading", () => {
      expect(superForm).dom.to.equalTag(`<super-form is-loading></super-form>`);
      expect(superForm.provision).toEqual(null);
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/submit",
        expect.objectContaining({
          method: "PUT",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: expect.toSatisfy((body: string) => {
            expect(JSON.parse(body)).toEqual(expect.objectContaining(formJson));
            return true;
          }),
        }),
      );
    });

    await waitForEvent(superForm, "super-form-error", () => {
      submitForm(superForm);
    });
    KitLogger.unsuppress();
    expect(superForm).dom.to.equalTag(`<super-form is-error></super-form>`);
    expect(superForm.provision?.body).toEqual({ message: "something broke" });
  });

  it("interpolates params from its own attributes and merges them with GET request attributes", async () => {
    const superForm = fixture<HTMLSuperFormElement>(
      `<super-form>${formHtml}</super-form>`,
    );
    const form = superForm.getFormElement()!;
    // will override languages param
    form.setAttribute("action", "/api/users/123?test=abc&languages=what");
    form.setAttribute("method", "get");

    const fetchSpy = spyFetch(fetchStubs.success as any);

    superForm.addEventListener("super-form-loading", () => {
      expect(superForm).dom.to.equalTag(`<super-form is-loading></super-form>`);
      expect(superForm.provision).toEqual(null);
    });

    await waitForEvent(superForm, "super-form-success", () => {
      submitForm(superForm);
    });
    expect(superForm).dom.to.equalTag(`<super-form is-success></super-form>`);
    expect(superForm.provision?.body).toEqual({ results: [{ a: 1 }] });
    const calledUrl = new URL(fetchSpy.mock.calls[0][0] as URL);
    expect(calledUrl.pathname).toBe("/api/users/123");
    expect(calledUrl.searchParams.get("test")).toBe("abc");
    expect(calledUrl.searchParams.get("email")).toBe("j@doe.com");
    expect(
      JSON.parse(calledUrl.searchParams.get("languages") as string),
    ).toEqual(["english", "spanish"]);
  });

  it("aborts existing fetch when new one is triggered", async () => {
    const superForm = fixture<HTMLSuperFormElement>(
      `<super-form>${formHtml}</super-form>`,
    );
    // Small delay so the second submit can abort the first in-flight request
    spyFetch(fetchStubs.success as any, 5);

    let loadingCount = 0;
    let numberOfSuccesses = 0;
    let numberOfErrors = 0;
    superForm.addEventListener("super-form-loading", () => {
      loadingCount++;
      expect(superForm).dom.to.equalTag(`<super-form is-loading></super-form>`);
    });
    superForm.addEventListener("super-form-success", () => {
      numberOfSuccesses++;
    });
    superForm.addEventListener("super-form-error", () => {
      numberOfErrors++;
    });

    const success = waitForEvent(superForm, "super-form-success");
    submitForm(superForm);
    submitForm(superForm);
    await success;

    expect(loadingCount).toBe(2);
    expect(numberOfSuccesses).toBe(1);
    expect(numberOfErrors).toBe(0);
  });
});

