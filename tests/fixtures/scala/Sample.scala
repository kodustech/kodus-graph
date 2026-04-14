import com.example.models.User
import com.example.services._

trait Repository {
  def find(id: Int): Option[User]
  def save(user: User): Unit
}

case class UserDTO(name: String, email: String)

object UserService {
  def create(): UserService = new UserService()
}

class UserService extends BaseService with Repository with Serializable {
  override def find(id: Int): Option[User] = None

  private def validate(user: User): Boolean = {
    user.name.nonEmpty
  }

  def getUser(id: Int): Future[User] = Future {
    find(id).getOrElse(throw new NotFoundException())
  }
}

sealed trait Status
case object Active extends Status
case object Inactive extends Status
