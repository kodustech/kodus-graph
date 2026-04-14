defmodule MyApp.UserService do
  use GenServer
  alias MyApp.Repo
  import Ecto.Query

  @moduledoc "Manages users"
  @behaviour MyApp.Repository

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  def get_user(id) do
    Repo.get(User, id)
  end

  defp validate(user) do
    if user.name == "" do
      raise ArgumentError, "empty name"
    end
    :ok
  end

  @impl true
  def init(opts) do
    {:ok, opts}
  end

  @impl true
  def handle_call({:get, id}, _from, state) do
    {:reply, get_user(id), state}
  end
end

defmodule MyApp.Repository do
  @callback get_user(integer()) :: User.t() | nil
  @callback save_user(User.t()) :: :ok | {:error, term()}
end
